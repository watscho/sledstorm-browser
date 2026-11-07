/* Copyright (c) 2026 Vacho Aivazov. SPDX-License-Identifier: MIT
 * Presentation-only GPU replay and isolated execution of the audited PAL HUD.
 * Console registers/RAM and canonical GPU state are restored before return. */
#include "sled-view.h"
#include "../plugins/gpulib/gpu.h"
#include "../libpcsxcore/psxmem.h"
#include "../libpcsxcore/r3000a.h"
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif

#define LIMIT 16384
#define VRAM_BYTES (1024 * 512 * 2)
#define RACER_BASE 0x800dae20u
#define RACER_SIZE 0x530u
#define RACER_AWARD 0x514u
#define AWARD_LATCH 0x800c2f80u
#define AWARD_DISPLAY 0x800c2f88u
#define AWARD_TICKS 0x800e3928u
typedef struct { uint32_t words[16], env[8]; unsigned count; } Primitive;
static Primitive primitives[LIMIT];
static uint16_t private_vram[1024 * 512];
static unsigned seat, enabled, recording, replaying, used, overflow, drawn, frames;
static unsigned last_clip, first_clip;
static uint32_t hud_words[256][9];
static unsigned hud_count, hud_error;
static int awards_advanced;
static unsigned char hud_ram[0x200000];
static unsigned native_frames, native_error, native_pc, native_cursor, native_packets;
static unsigned char render_ram[0x200000], render_scratch[0x400];
static psxRegisters render_regs;
static int render_captured, render_prepare;
static unsigned native_rank, native_mode, canonical_packets, submission_packets;
static int native_single_view;
static unsigned char native_scratch[sizeof(render_scratch)];
int sled_view_transaction, sled_view_hardware_access;
extern void sled_renderer_set_vram(void *pointer);

static uint32_t ram32(unsigned address) {
  uint32_t value; memcpy(&value, psxM + (address & 0x1fffff), 4); return value;
}
static void *ram(unsigned address) { return psxM + (address & 0x1fffff); }
static void word(unsigned address, uint32_t value) { memcpy(ram(address), &value, 4); }
static unsigned half(unsigned address) { uint16_t value; memcpy(&value, ram(address), 2); return value; }
static void set_half(unsigned address, uint16_t value) { memcpy(ram(address), &value, 2); }
static int guest_call(psxRegisters *regs, uint32_t target) {
  const uint32_t end = 0x80053e24;
  regs->GPR.n.ra = end; regs->pc = target;
  unsigned budget = target == 0x80051010 ? 250000 : 20000;
  while (regs->pc != end && !sled_view_hardware_access && budget--) psxCpu->ExecuteBlock(regs, EXEC_CALLER_OTHER);
  if (sled_view_transaction == 2) native_pc = regs->pc;
  return regs->pc == end;
}
static unsigned count_ordering_packets(unsigned head, unsigned *tail) {
  unsigned cursor = head & 0xffffff, packets = 0, budget = 65536;
  while (!(cursor & 0x800000) && budget--) {
    if (cursor >= 0x200000 || (cursor & 3)) break;
    unsigned tag = ram32(cursor), count = tag >> 24;
    if (cursor + 4 + count * 4 > 0x200000) break;
    packets += count > 0;
    cursor = tag & 0xffffff;
  }
  if (tail) *tail = cursor;
  return packets;
}

/* Experimental native PAL world render. Build the original single-player
 * ordering table in an isolated interpreter pass and submit it to private VRAM. */
static unsigned build_native_world(unsigned base_y) {
  if (!render_captured) return 0;
  const unsigned gp = 0x800c1f18, view = 0x800e2cb0;
  const unsigned selected = view + seat * 0x224;
  psxRegisters saved = psxRegs;
  memcpy(hud_ram, psxM, sizeof(hud_ram));
  memcpy(native_scratch, psxH, sizeof(render_scratch));
  sled_view_cache_save(0);
  memcpy(psxM, render_ram, sizeof(render_ram));
  memcpy(psxH, render_scratch, sizeof(render_scratch));
  psxRegs = render_regs;
  sled_view_transaction = 2;
  sled_view_hardware_access = 0;
  const unsigned camera = ram32(selected + 0x220), context = ram32(0x800c3cb8);
  const unsigned rank = ram32(gp + 0x1ff0);
  native_error = 1;
  if (camera < 0x80010000 || camera >= 0x80200000 ||
      context < 0x80010000 || context > 0x80200000 - 0x74 ||
      rank > (0x80200000 - context - 0x74) / 4u || rank > 0x8000)
    goto restore;
  const unsigned ot = context + 0x70;
  const unsigned players = ram32(0x800d6a10);
  native_mode = ram32(0x800d6a5c);
  psxRegs.CP0.n.SR &= ~1u;
  native_error = 2;
  int configured = 1;
  if (!(enabled & 8)) {
    /* Keep view zero's render buffers. The layout function installs the
     * selected racer's camera without aliasing the other view's buffers. */
    word(0x800d6a10, 1);
    psxRegs.GPR.n.a0 = view;
    psxRegs.GPR.n.a1 = camera;
    psxRegs.GPR.n.a2 = psxRegs.GPR.n.a3 = 0;
    configured = guest_call(&psxRegs, 0x8005aea0) &&
      ram32(view + 0x158) == 0x01000200;
    word(0x800d6a10, players);
    /* The frame begins with player one's projection origin and matrix.
     * Set both before rebuilding objects for the selected full view. */
    psxRegs.GPR.n.a0 = ram32(view + 0x20c);
    psxRegs.GPR.n.a1 = ram32(view + 0x210);
    configured = configured && guest_call(&psxRegs, 0x80085a6c);
    psxRegs.GPR.n.a0 = camera;
    configured = configured && guest_call(&psxRegs, 0x80053e8c);
  }
  if (configured) {
    native_error = 3;
    native_single_view = !(enabled & 8);
    if ((!render_prepare || guest_call(&psxRegs, 0x80079dec)) && guest_call(&psxRegs, 0x80051010)) {
      native_error = 4;
      /* The renderer advances the ordering-table rank as it inserts
       * geometry. The frame dispatcher reads this value after rendering. */
      native_rank = ram32(gp + 0x1ff0);
      if (native_rank > 0x8000 || native_rank > (0x80200000 - ot - 4u) / 4u)
        goto restore;
      const unsigned head = ot + native_rank * 4;
      native_packets = count_ordering_packets(head, &native_cursor);
      if (!(enabled & 8) && (native_cursor & 0x800000) && native_packets > 4) {
        for (unsigned y = base_y; y < base_y + 256; ++y)
          memset(private_vram + y * 1024, 0, 512 * sizeof(*private_vram));
        gpu.ex_regs[3] = 0xe3000000u | (base_y << 10);
        gpu.ex_regs[4] = 0xe4000000u | ((base_y + 255) << 10) | 511;
        gpu.ex_regs[5] = 0xe5000000u | (base_y << 11);
        renderer_sync_ecmds(gpu.ex_regs);
        int32_t cycles_last_cmd;
        GPUdmaChain((uint32_t *)psxM, head, NULL, &cycles_last_cmd);
        ++native_frames;
        native_error = 0;
      }
    }
  }
restore:
  native_single_view = 0;
  if (sled_view_hardware_access) native_error += 10;
  sled_view_hardware_access = 0;
  memcpy(psxM, hud_ram, sizeof(hud_ram));
  memcpy(psxH, native_scratch, sizeof(render_scratch));
  psxRegs = saved;
  sled_view_cache_save(1);
  sled_view_transaction = 0;
  return !native_error;
}

/* Preserve the PAL award state from 0x80060dec when replacing the stock HUD.
 * Advance the countdown at the start of the next draw so the last tick is
 * still visible to this frame's private renderer. */
static void advance_award_popups(unsigned players) {
  for (unsigned slot = 0; slot < players; ++slot) {
    const int32_t event = (int32_t)ram32(RACER_BASE + slot * RACER_SIZE + RACER_AWARD);
    const unsigned timer = AWARD_TICKS + slot * 4;
    const unsigned latch = AWARD_LATCH + slot * 2;
    const unsigned display = AWARD_DISPLAY + slot * 2;
    unsigned ticks = ram32(timer);
    if (ticks) --ticks;
    if (event < 0 && !ticks) {
      word(timer, 0);
      continue;
    }
    int value = (int16_t)event;
    if (event > 0) {
      set_half(latch, value);
      ticks = 20;
    }
    if (value < 0) value = (int16_t)half(latch);
    const int next = (int16_t)half(display) + 25;
    if (next < value && value < 500) {
      value = next;
      ticks = 20;
    }
    set_half(display, value);
    word(timer, ticks);
  }
}

int sled_view_pc(psxRegisters *regs) {
  if (sled_view_transaction) {
    if (native_single_view) {
      /* Keep the multiplayer preparation and resource tables. Stop after
       * the first drawing pass, using the full-size view in that slot. */
      if (regs->pc == 0x80051e38) regs->GPR.n.v0 = 1;
      /* Allow the stock background draw in this isolated full-size view.
       * The original four-view branch has a NOP delay slot. */
      if (regs->pc == 0x80051af0 && ram32(0x800e2cb0 + 0x80)) {
        regs->pc += 8;
        return 1;
      }
    }
    return 0;
  }
  /* Native-camera rooms apply this resource hook on every console. The
   * four-view path normally skips the original background at each stage. */
  if ((enabled & 16) && (regs->pc == 0x8004a41c || regs->pc == 0x8004c700 ||
                         regs->pc == 0x8004ac84) && ram32(0x800d6a10) == 4) {
    regs->pc += 8;
    return 1;
  }
  if (regs->pc == 0x80014e98 || regs->pc == 0x80053e68) {
    if ((enabled & 4) && recording) {
      unsigned address = regs->pc == 0x80053e68
        ? regs->GPR.n.v0 + regs->GPR.n.a0
        : ram32(0x800c3cb8) + 0x70 + ram32(0x800c3f08) * 4;
      unsigned packets = count_ordering_packets(address, NULL);
      if (regs->pc == 0x80053e68) submission_packets = packets;
      else canonical_packets = packets;
    }
    return 0;
  }
  if (regs->pc == 0x80014e88 || regs->pc == 0x80014e90) {
    if ((enabled & 4) && recording && !render_captured) {
      render_prepare = regs->pc == 0x80014e88;
      memcpy(render_ram, psxM, sizeof(render_ram));
      memcpy(render_scratch, psxH, sizeof(render_scratch));
      render_regs = *regs;
      render_captured = 1;
    }
    return 0;
  }
  if (!(enabled & 2)) return 0;
  if (regs->pc == 0x8005f344) {
    const unsigned names[] = {0x10634, 0x10628, 0x1061c, 0x10610, 0x10604, 0x105f8, 0x105ec, 0x105e0};
    for (unsigned i = 0; i < 8; i++) {
      unsigned char *p = ram(names[i]);
      if (!memcmp(p, "load", 4) && (p[4] == '6' || p[4] == (i < 4 ? '8' : '9'))
          && p[5] == '1' + i % 4 && !memcmp(p + 6, ".psh", 4))
        p[4] = ram32(0x800d6a10) >= 2 ? '6' : (i < 4 ? '8' : '9');
    }
    return 0;
  }
  unsigned players = ram32(0x800d6a10);
  if ((regs->pc != 0x80064128 && regs->pc != 0x800650fc) || ram32(0x800d6980) != 1 || players < 2 || players > 4
      || ram32(0x800c3ca0) != 0 || ram32(0x800c34e0)) return 0;
  /* The original multiplayer HUD is replaced at presentation. Building four
   * single-player HUDs canonically would overflow the game's 256 UI slots. */
  advance_award_popups(players);
  awards_advanced = 1;
  regs->pc = regs->GPR.n.ra;
  return 1;
}
static void build_local_hud(void) {
  const unsigned gp = 0x800c1f18;
  unsigned table = ram32(0x800c1f58), context = ram32(0x800c3cb8), rank = ram32(gp + 0x1ff0);
  hud_count = hud_error = 0;
  if (table < 0x80000000 || table > 0x801f0000 - 256 * 80 || context < 0x80000000
      || context > 0x80200000 - 0x70 || rank > 0x8000 || context + 0x70 + rank * 4 >= 0x80200000) {
    hud_error = 1; return;
  }
  /* Only this audited RAM-only UI routine runs in the sandbox. Freeze event
   * dispatch, preserve the complete interpreter registers and RAM, and use a
   * private ordering table. No savestate LoadState/timer normalization occurs. */
  psxRegisters saved = psxRegs;
  sled_view_cache_save(0);
  memcpy(hud_ram, psxM, sizeof(hud_ram));
  sled_view_transaction = 1;
  psxRegs.GPR.n.gp = gp; psxRegs.GPR.n.sp = 0x801ff000;
  psxRegs.CP0.n.SR &= ~1u;
  memcpy(ram(RACER_BASE), hud_ram + (RACER_BASE & 0x1fffff) + seat * RACER_SIZE, RACER_SIZE);
  const int32_t event = (int32_t)ram32(RACER_BASE + RACER_AWARD);
  const unsigned display = half(AWARD_DISPLAY + seat * 2);
  const unsigned ticks = ram32(AWARD_TICKS + seat * 4);
  set_half(AWARD_LATCH, half(AWARD_LATCH + seat * 2));
  set_half(AWARD_DISPLAY, display);
  word(AWARD_TICKS, ticks);
  if (awards_advanced) {
    // Give the original digit renderer the already advanced value for this racer.
    word(AWARD_TICKS, 0);
    word(RACER_BASE + RACER_AWARD, event >= 0 || ticks ? display : UINT32_MAX);
  }
  set_half(gp + 0x205a, 0);
  memset(ram(0x800de648), 0, 256);
  unsigned ot = context + 0x70;
  for (unsigned index = 0; index <= rank; index++) word(ot + index * 4, index ? (ot + (index - 1) * 4) & 0xffffff : 0xffffff);
  if (!guest_call(&psxRegs, 0x80061d40)) hud_error = 2;
  unsigned end = half(gp + 0x205a);
  if (end > 256) hud_error = 3;
  if (!hud_error) {
    unsigned address = (ot + rank * 4) & 0xffffff, budget = 65536;
    unsigned physical_table = table & 0x1fffff;
    while (address < 0x200000 && budget > 0) {
      --budget;
      unsigned tag = ram32(address);
      if ((tag >> 24) == 9 && address >= physical_table && address < physical_table + end * 80
          && ((address - physical_table) % 80 == 0 || (address - physical_table) % 80 == 40)
          && (((unsigned char *)ram(address))[7] & 0xfc) == 0x2c) {
        if (hud_count == 256) { hud_error = 4; break; }
        memcpy(hud_words[hud_count++], ram(address + 4), 9 * 4);
      }
      address = tag & 0xffffff;
    }
    if (!budget && address < 0x200000) hud_error = 5;
  }
  memcpy(psxM, hud_ram, sizeof(hud_ram));
  psxRegs = saved;
  sled_view_cache_save(1);
  sled_view_transaction = 0;
  if (hud_error) hud_count = 0;
}
void sled_view_configure(unsigned slot, unsigned flags) { seat = slot; enabled = flags; }
unsigned sled_view_status(unsigned field) {
  switch (field) {
    case 0: return used; case 1: return drawn; case 2: return overflow;
    case 3: return frames; case 4: return first_clip; case 5: return last_clip;
    case 6: return hud_count; case 7: return hud_error;
    case 8: return native_frames; case 9: return native_error; case 10: return native_pc;
    case 11: return native_cursor; case 12: return native_packets;
    case 13: return native_rank; case 14: return native_mode;
    case 15: return canonical_packets; case 16: return submission_packets;
    default: return 0;
  }
}
void sled_view_begin(void) {
  used = overflow = drawn = 0;
  render_captured = 0;
  awards_advanced = 0;
  unsigned players = ram32(0x800d6a10);
#ifdef __EMSCRIPTEN__
  const int skip_presentation = EM_ASM_INT({
    return (Module._sled_netplay_status && Module._sled_netplay_status(3)) ||
      (Module.sledDedicatedClient && (document.hidden || Module.sledCatchup));
  });
#else
  const int skip_presentation = 0;
#endif
  recording = !skip_presentation && (enabled & 1) && seat < players && players >= 2 && players <= 4 && ram32(0x800d6980) == 1
    && ram32(0x800c3ca0) == 0
    && ram32(0x800c34e0) == 0;
}
void sled_view_record(const uint32_t *words, unsigned count) {
  unsigned command = words[0] >> 24;
  if (!recording || replaying || command < 0x20 || command >= 0x80) return;
  /* Polylines have variable length. Fail closed until their parser is added. */
  if ((command & 0xe8) == 0x48 || count > 16 || used == LIMIT) { overflow++; return; }
  Primitive *p = &primitives[used++];
  memcpy(p->words, words, count * 4);
  memcpy(p->env, gpu.ex_regs, sizeof(p->env));
  p->count = count;

}
static uint32_t doubled_xy(uint32_t word, int ox, int oy) {
  int x = 2 * ((int16_t)word + ox), y = 2 * ((int16_t)(word >> 16) + oy);
  return (uint16_t)x | ((uint32_t)(uint16_t)y << 16);
}
static unsigned double_geometry(uint32_t *words, unsigned count, const uint32_t *env, unsigned x, unsigned y) {
  unsigned command = words[0] >> 24;
  int ox = (int)(env[5] & 2047), oy = (int)((env[5] >> 11) & 2047);
  if (ox & 1024) ox -= 2048;
  if (oy & 1024) oy -= 2048;
  ox -= x; oy -= y;
  if (command < 0x40) {
    unsigned stride = 1 + !!(command & 4) + !!(command & 16);
    for (unsigned vertex = 0; vertex < ((command & 8) ? 4 : 3); vertex++) {
      unsigned index = 1 + vertex * stride;
      words[index] = doubled_xy(words[index], ox, oy);
    }
  } else if (command < 0x60) {
    words[1] = doubled_xy(words[1], ox, oy);
    unsigned index = (command & 16) ? 3 : 2;
    words[index] = doubled_xy(words[index], ox, oy);
  } else {
    unsigned size = command & 0x18;
    unsigned width = size == 8 ? 1 : size == 16 ? 8 : size == 24 ? 16 : words[(command & 4) ? 3 : 2] & 0xffff;
    unsigned height = size ? width : words[(command & 4) ? 3 : 2] >> 16;
    uint32_t xy = doubled_xy(words[1], ox, oy);
    if (command & 4) {
      /* Rasterize textured rectangles as quads so scaling preserves UV extent. */
      uint32_t uv = words[2], right_uv = (uv & ~255u) | (((uv & 255) + width) & 255);
      uint32_t lower_uv = ((uv & 0xff00) + (height << 8)) & 0xff00;
      uint32_t right_xy = (xy & 0xffff0000) | (uint16_t)((uint16_t)xy + width * 2);
      uint32_t lower_xy = ((uint32_t)(uint16_t)((xy >> 16) + height * 2) << 16);
      words[0] = (words[0] & 0xffffff) | ((0x2cu | (command & 3)) << 24);
      words[1] = xy; words[2] = uv;
      words[3] = right_xy; words[4] = (right_uv & 0xffff) | ((env[1] & 0x1ff) << 16);
      words[5] = (xy & 0xffff) | lower_xy; words[6] = (uv & 255) | lower_uv;
      words[7] = (right_xy & 0xffff) | lower_xy; words[8] = (right_uv & 255) | lower_uv;
      count = 9;
    } else {
      words[0] = (words[0] & 0xffffff) | ((0x60u | (command & 3)) << 24);
      words[1] = xy; words[2] = width * 2 | (height * 2 << 16); count = 3;
    }
  }
  return count;
}
void sled_view_present(void) {
  if (!recording || overflow || !used) return;
#ifdef __EMSCRIPTEN__
  EM_ASM({ if (Module.sledViewBefore) Module.sledViewBefore(); });
#endif
  struct psx_gpu saved = gpu;
  memcpy(private_vram, gpu.vram, VRAM_BYTES);
  gpu.vram = private_vram;
  sled_renderer_set_vram(private_vram);
  replaying = 1;
  int base_y = -1;
  unsigned world_drawn = 0, players = ram32(0x800d6a10);
  first_clip = last_clip = 0;
  if ((enabled & 4) && saved.screen.src_y <= 256 && build_native_world(saved.screen.src_y)) {
    base_y = saved.screen.src_y;
    world_drawn = 1;
  }

  const unsigned replay_count = world_drawn ? 0 : used;
  for (unsigned i = 0; i < replay_count; i++) {
    Primitive *p = &primitives[i];
    unsigned x = p->env[3] & 1023, y = (p->env[3] >> 10) & 511;
    unsigned right = p->env[4] & 1023, bottom = (p->env[4] >> 10) & 511;
    /* PAL's right pane starts at 258, preserving the native two-pixel divider.
     * Its projection still uses a 256-pixel view; only the clip is narrower. */
    if ((right < x || bottom < y || (right - x != 255 && right - x != 253))) continue;
    if ((players == 2 ? bottom - y != 255 : (bottom - y != 127 && bottom - y != 126))) continue;
    unsigned owner = (x >= 256) + (players > 2 && (y % 256) >= 128 ? 2 : 0);
    if (owner != seat) continue;
    unsigned draw_y = y & ~255u;
    if (base_y < 0) {
      base_y = draw_y;
      for (unsigned line = draw_y; line < draw_y + 256; line++) memset(private_vram + line * 1024, 0, 512 * 2);
      first_clip = p->env[3];
    }
    if ((int)draw_y != base_y) continue;
    last_clip = p->env[4];
    uint32_t env[8];
    memcpy(env, p->env, sizeof(env));
    int offset_x = (int)(env[5] & 2047);
    if (offset_x & 1024) offset_x -= 2048;
    uint32_t words[16]; memcpy(words, p->words, p->count * 4);
    unsigned count = p->count;
    if (players > 2) {
      count = double_geometry(words, count, env, x, y);
      env[5] = 0xe5000000u | ((unsigned)base_y << 11);
    } else {
      offset_x += 128 - (int)x;
      env[5] = (env[5] & ~2047u) | ((unsigned)offset_x & 2047);
    }
    env[3] = 0xe3000000u | ((unsigned)base_y << 10);
    env[4] = 0xe4000000u | ((unsigned)(base_y + 255) << 10) | 511;
    renderer_sync_ecmds(env);
    int sum = 0, cycles = 0, command = 0;
    do_cmd_list(words, count, &sum, &cycles, &command);
    world_drawn++;
    drawn++;
  }
  if (world_drawn) {
    if (enabled & 2) {
      build_local_hud();
      uint32_t env[8]; memcpy(env, saved.ex_regs, sizeof(env));
      env[2] = 0xe2000000u;
      env[3] = 0xe3000000u | ((unsigned)base_y << 10);
      env[4] = 0xe4000000u | ((unsigned)(base_y + 255) << 10) | 511;
      env[5] = 0xe5000000u | ((unsigned)base_y << 11);
      env[6] = 0xe6000000u;
      renderer_sync_ecmds(env);
      for (unsigned index = 0; index < hud_count; index++) {
        int sum = 0, cycles = 0, command = 0;
        do_cmd_list(hud_words[index], 9, &sum, &cycles, &command);
      }
    }
    gpu.screen.src_x = 0; gpu.screen.src_y = base_y;
    gpu.screen.x = gpu.screen.y = 0;
    gpu.screen.w = gpu.screen.hres = 512;
    gpu.screen.h = gpu.screen.vres = 256;
    gpu.state.dims_changed = 1;
    vout_update();
    frames++;
  }
  gpu = saved;
  sled_renderer_set_vram(gpu.vram);
  renderer_sync_ecmds(gpu.ex_regs);
  replaying = 0;
#ifdef __EMSCRIPTEN__
  EM_ASM({ if (Module.sledViewAfter) Module.sledViewAfter(); });
#endif
}

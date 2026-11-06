/* Copyright (c) 2026 Vacho Aivazov. SPDX-License-Identifier: MIT
 * Experimental presentation-only GPU replay. Never writes canonical PSX RAM
 * or VRAM. This is a camera laboratory, not the default multiplayer renderer. */
#include "sled-view.h"
#include "../plugins/gpulib/gpu.h"
#include "../libpcsxcore/psxmem.h"
#include "../libpcsxcore/r3000a.h"
#include <stdlib.h>
#include <string.h>

#define LIMIT 16384
#define VRAM_BYTES (1024 * 512 * 2)
typedef struct { uint32_t words[16], env[8]; unsigned count; int hud; } Primitive;
static Primitive primitives[LIMIT];
static uint16_t private_vram[1024 * 512];
static unsigned seat, enabled, recording, replaying, used, overflow, drawn, frames;
static unsigned last_clip, first_clip;
static uint32_t hud_packets[512];
static unsigned hud_count;
static int busy;
extern void sled_renderer_set_vram(void *pointer);

static uint32_t ram32(unsigned address) {
  uint32_t value;
  memcpy(&value, psxM + (address & 0x1fffff), 4);
  return value;
}
static void *ram(unsigned address) { return psxM + (address & 0x1fffff); }
static unsigned half(unsigned address) { uint16_t value; memcpy(&value, ram(address), 2); return value; }
static void guest_call(psxRegisters *regs, uint32_t target) {
  const uint32_t end = 0x80053e24;
  regs->GPR.n.ra = end;
  regs->pc = target;
  unsigned budget = 20000;
  while (regs->pc != end && budget--) psxCpu->ExecuteBlock(regs, EXEC_CALLER_OTHER);
  if (regs->pc != end) abort(); // Never continue from a partial guest call.
}
int sled_view_pc(psxRegisters *regs) {
  if (!(enabled & 2) || busy) return 0;
  if (regs->pc == 0x8005f344) {
    const unsigned names[] = {0x10634, 0x10628, 0x1061c, 0x10610, 0x10604, 0x105f8, 0x105ec, 0x105e0};
    for (unsigned i = 0; i < 8; i++) {
      unsigned char *p = ram(names[i]);
      if (!memcmp(p, "load", 4) && (p[4] == '6' || p[4] == (i < 4 ? '8' : '9'))
          && p[5] == '1' + i % 4 && !memcmp(p + 6, ".psh", 4))
        p[4] = ram32(0x800d6a10) == 2 ? '6' : (i < 4 ? '8' : '9');
    }
    return 0;
  }
  if (regs->pc != 0x80064128 || ram32(0x800d6980) != 1 || ram32(0x800d6a10) != 2
      || ram32(0x800c3ca0) != 0 || ram32(0x800c34e0)) return 0;
  unsigned table = ram32(0x800c1f58), gp = regs->GPR.n.gp, start = half(gp + 0x205a);
  if (table < 0x80000000 || table > 0x80200000 - 256 * 80 || start > 100) abort();
  unsigned char racer[0x530];
  memcpy(racer, ram(0x800dae20), sizeof(racer));
  memset(ram(0x800de648 + start), 0, 256 - start);
  uint32_t return_pc = regs->GPR.n.ra;
  busy = 1; hud_count = 0;
  for (unsigned player = 0; player < 2; player++) {
    if (player) memcpy(ram(0x800dae20), ram(0x800dae20 + player * 0x530), sizeof(racer));
    guest_call(regs, 0x80061d40);
    unsigned end = half(gp + 0x205a);
    if (end < start || end > 256) abort();
    for (unsigned slot = start; slot < end; slot++) for (unsigned frame = 0; frame < 2; frame++) {
      unsigned address = table + slot * 80 + frame * 40;
      if ((ram32(address) >> 24) == 9 && (((unsigned char *)ram(address))[7] & 0xfc) == 0x2c)
        hud_packets[hud_count++] = (address & 0x1fffff) | (player << 24);
    }
    start = end;
  }
  memcpy(ram(0x800dae20), racer, sizeof(racer));
  regs->GPR.n.ra = return_pc; regs->pc = return_pc;
  busy = 0;
  return 1;
}
void sled_view_configure(unsigned slot, unsigned flags) { seat = slot; enabled = flags; }
unsigned sled_view_status(unsigned field) {
  switch (field) {
    case 0: return used; case 1: return drawn; case 2: return overflow;
    case 3: return frames; case 4: return first_clip; case 5: return last_clip;
    default: return 0;
  }
}
void sled_view_begin(void) {
  used = overflow = drawn = 0;
  recording = enabled && seat < 2 && ram32(0x800d6980) == 1
    && ram32(0x800d6a10) == 2 && ram32(0x800c3ca0) == 0
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
  p->hud = -1;
  uintptr_t address = (uintptr_t)words - (uintptr_t)psxM;
  if (address >= 4 && address < 0x200000) {
    for (unsigned i = 0; i < hud_count; i++)
      if ((hud_packets[i] & 0x1fffff) == address - 4) { p->hud = hud_packets[i] >> 24; break; }
  }
}
void sled_view_present(void) {
  if (!recording || overflow || !used) return;
  struct psx_gpu saved = gpu;
  memcpy(private_vram, gpu.vram, VRAM_BYTES);
  gpu.vram = private_vram;
  sled_renderer_set_vram(private_vram);
  replaying = 1;
  int base_y = -1;
  first_clip = last_clip = 0;
  for (unsigned i = 0; i < used; i++) {
    Primitive *p = &primitives[i];
    unsigned x = p->env[3] & 1023, y = (p->env[3] >> 10) & 511;
    unsigned right = p->env[4] & 1023, bottom = (p->env[4] >> 10) & 511;
    int hud = p->hud >= 0;
    if (hud && (unsigned)p->hud != seat) continue;
    /* PAL's right pane starts at 258, preserving the native two-pixel divider.
     * Its projection still uses a 256-pixel view; only the clip is narrower. */
    if (!hud && (right < x || bottom < y || (right - x != 255 && right - x != 253) || bottom - y != 255)) continue;
    if (!hud && ((x >= 256) != (seat == 1))) continue;
    if (base_y < 0) {
      base_y = y;
      for (unsigned line = y; line <= bottom; line++) memset(private_vram + line * 1024, 0, 512 * 2);
      first_clip = p->env[3];
    }
    if ((int)y != base_y) continue;
    last_clip = p->env[4];
    uint32_t env[8];
    memcpy(env, p->env, sizeof(env));
    int offset_x = (int)(env[5] & 2047);
    if (offset_x & 1024) offset_x -= 2048;
    if (!hud) offset_x += 128 - (int)x;
    env[3] = 0xe3000000u | (y << 10);
    env[4] = 0xe4000000u | (bottom << 10) | 511;
    env[5] = (env[5] & ~2047u) | ((unsigned)offset_x & 2047);
    renderer_sync_ecmds(env);
    int sum = 0, cycles = 0, command = 0;
    do_cmd_list(p->words, p->count, &sum, &cycles, &command);
    drawn++;
  }
  if (drawn) {
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
}

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
static const uint16_t *enhanced_frame;
static const uint16_t *wide_frame;
static const uint16_t *wide_enhanced_frame;
static int wide_pending, wide_world, wide_cull, wide_requested;
static int hold_frame;
static int presented_wide;
static unsigned missed_wide_frames;
static int recovery_preview;
static double next_recovery_preview_ms;
static unsigned recovery_backlog, last_recovery_preview_backlog;
enum {
  BLOCK_PRESENTATION = 1, RECOVERING = 2,
  RECOVERY_PREVIEW_INTERVAL_MS = 80, RECOVERY_PREVIEW_PROGRESS_FRAMES = 2
};
static int32_t primitive_budget;
static unsigned distance_target, distance_limit, distance_trim, distance_headroom;
static int distance_match_solo;
static unsigned native_passes;
static unsigned respawn_fade_quad;
static int starting_grid;
static unsigned grid_budget_reserved;
enum { GRID_PRIMITIVE_RESERVE = 768, GRID_SHADOW_RESERVE = 16 };
static uint16_t hud_background[SLED_WIDE_WIDTH * 256];
const uint16_t *sled_view_enhanced_frame(void) { return enhanced_frame; }
const uint16_t *sled_view_wide_frame(void) { return wide_frame; }
const uint16_t *sled_view_wide_enhanced_frame(void) { return wide_enhanced_frame; }
int sled_view_wide_pending(void) { return wide_pending; }
int sled_view_hold_frame(void) { return hold_frame; }

/* Use the original rasterizer for HUD sprites. Copy only its changed pixels,
 * so the underlying 3D world keeps its enhanced resolution. */
static void overlay_stock_hud(uint16_t *output, const uint16_t *frame, unsigned width) {
  if (!output || !width) return;
  for (unsigned y = 0; y < 256; ++y) {
    const uint16_t *before = hud_background + y * width;
    const uint16_t *after = frame + y * 1024;
    uint16_t *upper = output + y * width * 4;
    uint16_t *lower = upper + width * 2;
    for (unsigned x = 0; x < width; ++x) {
      if (after[x] == before[x]) continue;
      upper[2 * x] = upper[2 * x + 1] = lower[2 * x] = lower[2 * x + 1] = after[x];
    }
  }
}
#endif

#define LIMIT 16384
#define VRAM_BYTES (1024 * 512 * 2)
#define RACER_BASE 0x800dae20u
#define RACER_SIZE 0x530u
#define RACER_SPEED 0x284u
#define RACER_DISPLAY_SPEED 0x288u
#define RACER_FINISHED 0x35cu
#define RACER_RACE_CLOCK 0x378u
#define SPEED_CURVE 0x800a72d4u
#define SPEED_UNITS 0x800c2824u
#define PRIMITIVE_BUDGET 0x800c3efcu
#define PRIMITIVE_CURSORS 0x800c3eb0u
#define PRIMITIVE_BANKS 0x800c3eb8u
#define PRIMITIVE_CAPACITY 0x800d6970u
#define PRIMITIVE_BYTES 40u
#define PRIMITIVE_HEADROOM 32u
#define PAL_SOLO_RANGE 10u
#define PAL_MIN_RANGE 7u
#define RACER_AWARD 0x514u
#define AWARD_LATCH 0x800c2f80u
#define AWARD_DISPLAY 0x800c2f88u
#define AWARD_TICKS 0x800e3928u
#define FINISH_TICKS 0x800a7400u
#define SNOW_LINE_BUFFERS 0x800c3cd8u
#define SNOW_LINE_SIZE 20u
#define SNOW_LINE_COUNT 200u
#define TREAD_RINGS 0x800dd4b0u
#define TREAD_RING_SIZE 0x14u
#define TREAD_BUFFER 0x800b0500u
#define TREAD_BUFFER_SIZE 0xf60u
#define TREAD_RING_COUNT 12u
typedef struct { uint32_t words[16], env[8]; unsigned count; } Primitive;
static Primitive primitives[LIMIT];
static uint16_t private_vram[1024 * 512];
static unsigned seat, enabled, recording, replaying, used, overflow, drawn, frames;
static unsigned last_clip, first_clip;
static uint32_t hud_words[256][9];
enum hud_popup { HUD_STATIC, HUD_AWARD, HUD_FINISH };
static unsigned char hud_popup[256];
static unsigned hud_count, hud_error;
static unsigned award_first, award_end;
static unsigned finish_first, finish_end, local_finish_ticks;
static uint32_t finish_ticks_before[4];
static struct { uint32_t event, ticks; uint16_t latch, display; } award_before[4];
static int hud_advanced;
static unsigned char hud_ram[0x200000];
static unsigned char local_hud_racer[RACER_SIZE];
static unsigned native_frames, native_error, native_pc, native_cursor, native_packets;
static unsigned char render_ram[0x200000], render_scratch[0x400];
static psxRegisters render_regs;
static int render_captured, render_prepare;
static int solo_render, solo_hud_captured, view_diagnostics;
#ifdef __EMSCRIPTEN__
static unsigned missed_personal_frames;
static int presented_personal, skip_personal;
#endif
static unsigned native_rank, native_mode, canonical_packets, submission_packets;
static unsigned native_range, native_treads;
static int native_single_view;
static int32_t snow_origin_x, snow_origin_y;
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

static void use_both_primitive_banks(void) {
  /* PAL allocates two contiguous primitive banks for alternating frames
   * (0x8004b7bc). The isolated start view submits synchronously, so it can
   * use both banks after verifying the layout and an empty current bank. */
  const unsigned frame = ram32(0x800d6968);
  const unsigned count = ram32(PRIMITIVE_CAPACITY);
  const unsigned first = ram32(PRIMITIVE_BANKS), second = ram32(PRIMITIVE_BANKS + 4);
  if (frame > 1 || count <= PRIMITIVE_HEADROOM ||
      first < 0x80010000 || (first & 3) || first >= second || second >= 0x80200000 ||
      count > (0x80200000 - second) / PRIMITIVE_BYTES ||
      second - first != count * PRIMITIVE_BYTES ||
      ram32(PRIMITIVE_BUDGET) != count - PRIMITIVE_HEADROOM)
    return;
  const unsigned cursor = PRIMITIVE_CURSORS + frame * 4;
  if (ram32(cursor) != (frame ? second : first)) return;
  word(cursor, first);
  word(PRIMITIVE_BUDGET, 2 * count - PRIMITIVE_HEADROOM);
}

static int personal_scene(unsigned players) {
  if (!(enabled & 1) || players < 2 || players > 4 || seat >= players ||
      ram32(0x800d6980) != 1 || ram32(0x800c3ca0)) return 0;
  const unsigned menu = ram32(0x800c34e0);
  return !menu || ((enabled & 4) && menu == 1);
}

static int tread_ring_ready(unsigned index) {
  if (index >= TREAD_RING_COUNT) return 0;
  const unsigned ring = TREAD_RINGS + index * TREAD_RING_SIZE;
  return ram32(ring + 8) == TREAD_BUFFER + index * TREAD_BUFFER_SIZE && half(ring + 12) < 24;
}

static int tread_rings_ready(void) {
  for (unsigned index = 0; index < TREAD_RING_COUNT; ++index)
    if (!tread_ring_ready(index)) return 0;
  return 1;
}

static int tread_projection_valid(const psxRegisters *regs) {
  /* RTPS has shifted the quad's four depths into SZ0..SZ3. */
  const unsigned near = (uint16_t)regs->CP2C.n.h / 2;
  for (unsigned i = 16; i <= 19; ++i)
    if (regs->CP2D.p[i].w.l <= near) return 0;
  const uint32_t points[] = {
    ram32(regs->GPR.n.a1 + 8), regs->CP2D.r[12], regs->CP2D.r[13], regs->CP2D.r[14]
  };
  int left = INT16_MAX, right = INT16_MIN, top = INT16_MAX, bottom = INT16_MIN;
  for (unsigned i = 0; i < 4; ++i) {
    const int x = (int16_t)points[i], y = (int16_t)(points[i] >> 16);
    if (x < left) left = x;
    if (x > right) right = x;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  /* A single tread segment can stretch into the sky at grazing angles.
   * Bound each segment in native pixels before the GPU clips the viewport. */
  return right - left <= 128 && bottom - top <= 128;
}

#ifdef __EMSCRIPTEN__
/* Spare PAL terrain primitives, not a wall-clock target: the decision stays
 * local to presentation and is stable across different refresh rates. */
enum {
  DISTANCE_STEP = 25, DISTANCE_LOW = 48, DISTANCE_HIGH = 144,
  DISTANCE_RECOVERY = 30, DISTANCE_MAX_TRIM = 2
};

static unsigned adaptive_distance(unsigned target, int match_solo) {
  if (target != distance_target || match_solo != distance_match_solo) {
    distance_target = target;
    distance_match_solo = match_solo;
    distance_limit = 0;
    distance_trim = distance_headroom = 0;
  }
  return distance_limit;
}

static void adjust_distance(int drawn, unsigned attempted) {
  if (!distance_target && !distance_match_solo) return;
  if (!drawn || primitive_budget < DISTANCE_LOW) {
    distance_limit = !drawn ? (attempted / (2 * DISTANCE_STEP)) * DISTANCE_STEP
      : attempted > DISTANCE_STEP ? attempted - DISTANCE_STEP : 0;
    if (!attempted && distance_match_solo && distance_trim < PAL_SOLO_RANGE - PAL_MIN_RANGE)
      distance_trim = drawn ? distance_trim + 1 : PAL_SOLO_RANGE - PAL_MIN_RANGE;
    distance_headroom = 0;
  } else if (primitive_budget >= DISTANCE_HIGH && (distance_trim || distance_limit < distance_target)) {
    /* Consecutive safe frames prevent repeated expensive probes on a bend. */
    if (++distance_headroom == DISTANCE_RECOVERY) {
      if (distance_trim) {
        --distance_trim;
      } else {
        distance_limit += DISTANCE_STEP;
        if (distance_limit > distance_target) distance_limit = distance_target;
      }
      distance_headroom = 0;
    }
  } else {
    distance_headroom = 0;
  }
}
#endif
static int guest_call(psxRegisters *regs, uint32_t target) {
  const uint32_t end = 0x80053e24;
  regs->GPR.n.ra = end; regs->pc = target;
  unsigned budget = target == 0x80051010 ? 250000 : 20000;
  while (regs->pc != end && !sled_view_hardware_access && budget--) psxCpu->ExecuteBlock(regs, EXEC_CALLER_OTHER);
  if (sled_view_transaction == 2) native_pc = regs->pc;
  return regs->pc == end;
}
static unsigned hud_packet_table(void) {
  const unsigned table = ram32(0x800c1f58);
  if (table < 0x80000000 || table > 0x801f0000 - 256 * 80) return 0;
  return table & 0x1fffff;
}

static int is_hud_packet(unsigned address, unsigned count, unsigned table, unsigned entries) {
  return count == 9 && table && address >= table && address < table + entries * 80
    && (address - table) % 40 == 0 && (((unsigned char *)ram(address))[7] & 0xfc) == 0x2c;
}

enum ordering_hud { KEEP_HUD, CAPTURE_HUD, SKIP_HUD };

static unsigned walk_ordering_table(unsigned head, unsigned *tail, enum ordering_hud action) {
  unsigned cursor = head & 0xffffff, previous = cursor, packets = 0, budget = 65536;
  const unsigned table = action == KEEP_HUD ? 0 : hud_packet_table();
  while (!(cursor & 0x800000) && budget--) {
    if (cursor >= 0x200000 || (cursor & 3)) break;
    unsigned tag = ram32(cursor), count = tag >> 24;
    if (cursor + 4 + count * 4 > 0x200000) break;
    if (count && sled_view_transaction == 2 &&
        cursor >= (TREAD_BUFFER & 0x1fffff) &&
        cursor < (TREAD_BUFFER & 0x1fffff) + TREAD_RING_COUNT * TREAD_BUFFER_SIZE)
      ++native_treads;
#ifdef __EMSCRIPTEN__
    /* Extend the stock backdrop to cover the exposed margins of the private
     * wide view with the original fog gradient. */
    if (sled_view_transaction == 2 && wide_world && wide_cull &&
        count == 8 && (ram32(cursor + 4) >> 24) == 0x38 &&
        ram32(cursor + 8) == 0 && ram32(cursor + 16) == 512 &&
        ram32(cursor + 24) == 0x01000000 && ram32(cursor + 32) == 0x01000200) {
      set_half(cursor + 8, (uint16_t)-SLED_WIDE_MARGIN);
      set_half(cursor + 16, 512 + SLED_WIDE_MARGIN);
      set_half(cursor + 24, (uint16_t)-SLED_WIDE_MARGIN);
      set_half(cursor + 32, 512 + SLED_WIDE_MARGIN);
    }
#endif
    if (is_hud_packet(cursor, count, table, 256)) {
      if (action == SKIP_HUD && cursor != (head & 0xffffff)) {
        word(previous, (ram32(previous) & 0xff000000) | (tag & 0xffffff));
        cursor = tag & 0xffffff;
        continue;
      }
      if (action == CAPTURE_HUD) {
        if (hud_count == 256) break;
        memcpy(hud_words[hud_count++], ram(cursor + 4), sizeof(hud_words[0]));
      }
    }
    packets += count > 0;
    previous = cursor;
    cursor = tag & 0xffffff;
  }
  if (tail) *tail = cursor;
  if (action == CAPTURE_HUD) {
    solo_hud_captured = table && (cursor & 0x800000);
    if (!solo_hud_captured) hud_count = 0;
  }
  return packets;
}

/* Experimental native PAL world render. Build the original single-player
 * ordering table in an isolated interpreter pass and submit it to private VRAM. */
static unsigned build_native_world(unsigned base_y, unsigned clear_start, unsigned clear_width,
                                   int match_solo, unsigned distance_boost, unsigned trim_cells) {
  if (!render_captured) return 0;
#ifdef __EMSCRIPTEN__
  ++native_passes;
#endif
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
#ifdef __EMSCRIPTEN__
  respawn_fade_quad = 0;
#endif
  const unsigned camera = ram32(selected + 0x220), context = ram32(0x800c3cb8);
  const unsigned rank = ram32(gp + 0x1ff0);
  native_error = 1;
  if (camera < 0x80010000 || camera >= 0x80200000 ||
      context < 0x80010000 || context > 0x80200000 - 0x74 ||
      rank > (0x80200000 - context - 0x74) / 4u || rank > 0x8000)
    goto restore;
  const unsigned ot = context + 0x70;
  const unsigned players = ram32(0x800d6a10);
  snow_origin_x = (int32_t)ram32(selected + 0x20c);
  snow_origin_y = (int32_t)ram32(selected + 0x210);
  native_mode = ram32(0x800d6a5c);
  psxRegs.CP0.n.SR &= ~1u;
  native_error = 2;
  int configured = 1;
  if (!(enabled & 8) && !(solo_render && ram32(view + 0x158) == 0x01000200)) {
    /* Keep view zero's render buffers. The layout function installs the
     * selected racer's camera without aliasing the other view's buffers. */
    const unsigned particle_lists[] = {0x144, 0x148, 0x14c};
    uint32_t particle_heads[3];
    for (unsigned i = 0; i < 3; ++i)
      particle_heads[i] = ram32(view + particle_lists[i]);
    word(0x800d6a10, 1);
    psxRegs.GPR.n.a0 = view;
    psxRegs.GPR.n.a1 = camera;
    psxRegs.GPR.n.a2 = psxRegs.GPR.n.a3 = 0;
    configured = guest_call(&psxRegs, 0x8005aea0) &&
      ram32(view + 0x158) == 0x01000200;
    word(0x800d6a10, players);
    /* Layout clears the existing emitter lists. Keep slot zero's nodes so
     * particle preparation can update them for the installed camera. */
    for (unsigned i = 0; i < 3; ++i)
      word(view + particle_lists[i], particle_heads[i]);
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
    const int multiplayer_grid = native_single_view && players >= 2 && !ram32(RACER_BASE + RACER_RACE_CLOCK);
    if (multiplayer_grid) use_both_primitive_banks();
#ifdef __EMSCRIPTEN__
    starting_grid = multiplayer_grid;
    grid_budget_reserved = 0;
#endif
    const unsigned stock_cells = ram32(camera + 0x70);
    unsigned cells = stock_cells;
    if (native_single_view && stock_cells >= PAL_MIN_RANGE && stock_cells <= PAL_SOLO_RANGE) {
      /* Full-size personal views use the solo range when the primitive pool
       * permits it. Keep the split-screen span as the fallback floor. */
      const unsigned base = match_solo ? PAL_SOLO_RANGE : stock_cells;
      cells = base + (base * distance_boost + 50) / 100 - trim_cells;
      if (match_solo && cells < stock_cells) cells = stock_cells;
      if (cells != stock_cells) {
        word(camera + 0x70, cells);
        word(camera + 0x78, (cells / 2) * 512);
      }
    }
    /* PAL projects the recorded tread rings before building the ordering table.
     * Use the installed camera and leave the shared framebuffer untouched. */
    if (render_prepare && native_single_view && players >= 2 && (enabled & 16) &&
        ram32(0x800d6a34) >= 121 && tread_rings_ready() && !guest_call(&psxRegs, 0x8003cd94))
      goto restore;
    if ((!render_prepare || guest_call(&psxRegs, 0x80079dec)) && guest_call(&psxRegs, 0x80051010)) {
#ifdef __EMSCRIPTEN__
      primitive_budget = (int32_t)ram32(PRIMITIVE_BUDGET);
      if (cells > stock_cells && primitive_budget <= 0)
        goto restore;
#endif
      native_error = 4;
      /* The renderer advances the ordering-table rank as it inserts
       * geometry. The frame dispatcher reads this value after rendering. */
      native_rank = ram32(gp + 0x1ff0);
      if (native_rank > 0x8000 || native_rank > (0x80200000 - ot - 4u) / 4u)
        goto restore;
      const unsigned head = ot + native_rank * 4;
      /* Solo has already queued its HUD in this table. Draw those quads
       * separately at native resolution, using the original frame's packets. */
      native_treads = 0;
      native_packets = walk_ordering_table(head, &native_cursor, solo_render ? SKIP_HUD : KEEP_HUD);
      if (!(enabled & 8) && (native_cursor & 0x800000) && native_packets > 4) {
#ifdef __EMSCRIPTEN__
        /* A budget fallback clears and redraws only the center. Leave its
         * first fade at stock width so the side margins blend only once. */
        if (respawn_fade_quad && (!wide_cull || primitive_budget > 0)) {
          const uint16_t left = (uint16_t)-SLED_WIDE_MARGIN;
          const uint16_t right = 512 + SLED_WIDE_MARGIN;
          set_half(respawn_fade_quad + 8, left);
          set_half(respawn_fade_quad + 12, right);
          set_half(respawn_fade_quad + 16, left);
          set_half(respawn_fade_quad + 20, right);
        }
#endif
        for (unsigned y = base_y; y < base_y + 256; ++y)
          memset(private_vram + y * 1024 + clear_start, 0, clear_width * sizeof(*private_vram));
        gpu.ex_regs[3] = 0xe3000000u | (base_y << 10);
        gpu.ex_regs[4] = 0xe4000000u | ((base_y + 255) << 10) | 511;
        gpu.ex_regs[5] = 0xe5000000u | (base_y << 11);
        renderer_sync_ecmds(gpu.ex_regs);
        int32_t cycles_last_cmd;
#ifdef __EMSCRIPTEN__
        /* A saturated wide pass only contributes its side margins. The
         * following stock pass redraws the center; don't rasterize it twice. */
        const int edges_only = wide_world && wide_cull && primitive_budget <= 0;
        sled_renderer_set_wide_edges(edges_only);
#endif
        GPUdmaChain((uint32_t *)psxM, head, NULL, &cycles_last_cmd);
#ifdef __EMSCRIPTEN__
        sled_renderer_set_wide_edges(0);
#endif
        ++native_frames;
        native_range = cells;
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

/* PAL updates the speedometer history in the HUD draw. Advance it even when
 * the canonical multiplayer HUD is suppressed, including on the server. */
static void advance_speedometers(unsigned players) {
  const int mph = half(SPEED_UNITS) != 0;
  for (unsigned slot = 0; slot < players; ++slot) {
    const unsigned racer = RACER_BASE + slot * RACER_SIZE;
    const unsigned raw = ram32(racer + RACER_SPEED);
    unsigned speed = raw <= 100 ? *(const uint8_t *)ram(SPEED_CURVE + raw) : 174;
    if (mph) speed = speed * 3 / 5;
    const unsigned address = racer + RACER_DISPLAY_SPEED;
    word(address, (ram32(address) + speed) >> 1);
  }
}

/* Mirror the PAL award state from 0x80060dec on every peer. Keep the original
 * inputs for the private HUD so the guest routine draws this tick itself. */
static void advance_award_popups(unsigned players) {
  for (unsigned slot = 0; slot < players; ++slot) {
    const int32_t event = (int32_t)ram32(RACER_BASE + slot * RACER_SIZE + RACER_AWARD);
    const unsigned timer = AWARD_TICKS + slot * 4;
    const unsigned latch = AWARD_LATCH + slot * 2;
    const unsigned display = AWARD_DISPLAY + slot * 2;
    unsigned ticks = ram32(timer);
    award_before[slot].event = event;
    award_before[slot].ticks = ticks;
    award_before[slot].latch = half(latch);
    award_before[slot].display = half(display);
    if (event < 0 && !ticks) continue;
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
    word(timer, ticks ? ticks - 1 : 0);
  }
}

/* Mirror the PAL finish loop's timer update without queuing banners from the
 * shared screen. The private HUD uses the pre-update tick for its own racer. */
static void advance_finish_popups(unsigned players) {
  const int show_finish = !(ram32(0x800d6990) & 2);
  for (unsigned slot = 0; slot < players; ++slot) {
    const unsigned timer = FINISH_TICKS + slot * 4;
    const uint32_t ticks = ram32(timer);
    const int finished = ram32(RACER_BASE + slot * RACER_SIZE + RACER_FINISHED) == 1;
    const uint32_t next = show_finish && finished ? (ticks < 200 ? ticks + 1 : 200) : 0;
    finish_ticks_before[slot] = ticks;
    if (next != ticks) word(timer, next);
  }
}

/* PAL joins each flake to its previous screen position and rejects long
 * segments. Move those endpoints from the split pane to the full-size origin. */
static void move_previous_snow(const psxRegisters *regs) {
  const unsigned frame = ram32(0x800d6968);
  const unsigned first = regs->GPR.n.a1, end = regs->GPR.n.a2;
  if (frame > 1 || first >= end || end > SNOW_LINE_COUNT) return;
  const unsigned buffer = ram32(SNOW_LINE_BUFFERS + 4 * (1 - frame));
  if (buffer < 0x80010000 || buffer > 0x80200000 - end * SNOW_LINE_SIZE) return;
  const int dx = regs->CP2C.n.ofx / 65536 - snow_origin_x;
  const int dy = regs->CP2C.n.ofy / 65536 - snow_origin_y;
  for (unsigned line = first; line < end; ++line) {
    const unsigned xy = buffer + line * SNOW_LINE_SIZE + 8;
    set_half(xy, (uint16_t)(half(xy) + dx));
    set_half(xy + 2, (uint16_t)(half(xy + 2) + dy));
  }
}

int sled_view_pc(psxRegisters *regs) {
  if (sled_view_transaction) {
    if (sled_view_transaction == 1) {
      if (regs->pc == 0x80061eb0 && hud_advanced) {
        /* The private HUD formats the canonical speed without smoothing it again. */
        regs->pc = 0x80061f78;
        return 1;
      }
      if (seat && regs->pc == 0x80062948) {
        /* The minimap walks every racer. Give it the real slot zero, then
         * restore the local HUD's racer for the award and finish routines. */
        memcpy(local_hud_racer, ram(RACER_BASE), RACER_SIZE);
        memcpy(ram(RACER_BASE), hud_ram + (RACER_BASE & 0x1fffff), RACER_SIZE);
      }
      if (seat && regs->pc == 0x80062950)
        memcpy(ram(RACER_BASE), local_hud_racer, RACER_SIZE);
      // The stock popup allocates its digit quads consecutively in the HUD pool.
      if (regs->pc == 0x80060dec) award_first = half(0x800c3f72);
      if (regs->pc == 0x8006126c) award_end = half(0x800c3f72);
      if (regs->pc == 0x8006159c) {
        /* The countdown has been queued. Run the finish banner loop for
         * just the local racer, already copied into slot zero. */
        finish_first = half(0x800c3f72);
        word(0x800d6a10, 1);
        local_finish_ticks = hud_advanced ? finish_ticks_before[seat] : ram32(FINISH_TICKS + seat * 4);
        word(FINISH_TICKS, 0);
      }
      /* Use the stock animation tick after PAL has calculated the pivot for
       * the private full-size banner. The stock pane has a different pivot. */
      if (regs->pc == 0x80061940) word(FINISH_TICKS, local_finish_ticks);
      if (regs->pc == 0x80061d14) finish_end = half(0x800c3f72);
    }
    if (native_single_view) {
      if (regs->pc == 0x8003d100 && !tread_projection_valid(regs)) {
        regs->pc = 0x8003d168;
        return 1;
      }
      // The snow positions and previous line buffer are partitioned by racer.
      if (regs->pc == 0x8004ede4) regs->GPR.n.a0 = seat;
      if (regs->pc == 0x80039c34 && ram32(0x800d6a10) > 1) move_previous_snow(regs);
#ifdef __EMSCRIPTEN__
      /* The private full-size start camera can fill PAL's primitive pool
       * before the draw reaches the grid. Share the original pool between
       * scenery, shadows and racers without increasing its capacity. */
      if (starting_grid && regs->pc == 0x80051520) {
        const int32_t remaining = (int32_t)ram32(PRIMITIVE_BUDGET);
        if (remaining > GRID_PRIMITIVE_RESERVE) {
          grid_budget_reserved = GRID_PRIMITIVE_RESERVE;
          word(PRIMITIVE_BUDGET, remaining - grid_budget_reserved);
        }
      }
      if (grid_budget_reserved && (regs->pc == 0x80051b38 || regs->pc == 0x80051c20)) {
        const unsigned released = regs->pc == 0x80051b38 ? GRID_SHADOW_RESERVE : grid_budget_reserved;
        const int32_t remaining = (int32_t)ram32(PRIMITIVE_BUDGET);
        grid_budget_reserved -= released;
        word(PRIMITIVE_BUDGET, (remaining > 0 ? (unsigned)remaining : 0) + released);
      }
      /* PAL has just filled the corners of its respawn fade quad. */
      if (wide_world && regs->pc == 0x80051680) respawn_fade_quad = regs->GPR.n.v0;
      /* PAL track edge checks documented by SledStormPSXRecomp. Only the
       * private render may retain triangles inside the added side margins. */
      if (wide_world && wide_cull && (regs->pc == 0x8007ec9c || regs->pc == 0x8007f2c0 ||
                         regs->pc == 0x8007f8c4 || regs->pc == 0x8007fe7c) &&
          regs->GPR.n.s6 == 0x01000200 && (int32_t)regs->GPR.n.t4 < 0) {
        const uint32_t a = regs->GPR.n.s3, b = regs->GPR.n.s4, c = regs->GPR.n.s5;
        const int ax = (int16_t)a, bx = (int16_t)b, cx = (int16_t)c;
        const int ay = (int16_t)(a >> 16), by = (int16_t)(b >> 16), cy = (int16_t)(c >> 16);
        if (((ax < 0 && bx < 0 && cx < 0) || (ax >= 512 && bx >= 512 && cx >= 512)) &&
            !(ax < -SLED_WIDE_MARGIN && bx < -SLED_WIDE_MARGIN && cx < -SLED_WIDE_MARGIN) &&
            !(ax >= 512 + SLED_WIDE_MARGIN && bx >= 512 + SLED_WIDE_MARGIN && cx >= 512 + SLED_WIDE_MARGIN) &&
            !(ay < 0 && by < 0 && cy < 0) && !(ay >= 256 && by >= 256 && cy >= 256)) {
          regs->GPR.n.t4 &= 0x7fffffffu;
        }
      }
#endif
      /* Keep the multiplayer preparation and resource tables. Stop after
       * the first drawing pass, using the full-size view in that slot. */
      if (regs->pc == 0x80051e3c) regs->GPR.n.v0 = 0;
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
    if (((enabled & 4) || solo_render) && recording) {
      if (regs->pc == 0x80053e68 && (solo_render || view_diagnostics)) {
        if (solo_render) hud_count = 0;
        submission_packets = walk_ordering_table(regs->GPR.n.v0 + regs->GPR.n.a0, NULL,
          solo_render ? CAPTURE_HUD : KEEP_HUD);
      } else if (regs->pc == 0x80014e98 && view_diagnostics) {
        const unsigned address = ram32(0x800c3cb8) + 0x70 + ram32(0x800c3f08) * 4;
        canonical_packets = walk_ordering_table(address, NULL, KEEP_HUD);
      }
    }
    return 0;
  }
  if (regs->pc == 0x80014e88 || regs->pc == 0x80014e90) {
    if (((enabled & 4) || solo_render) && recording && !render_captured) {
      render_prepare = regs->pc == 0x80014e88;
      memcpy(render_ram, psxM, sizeof(render_ram));
      memcpy(render_scratch, psxH, sizeof(render_scratch));
      render_regs = *regs;
      render_captured = 1;
    }
    return 0;
  }
  if (!(enabled & 2)) return 0;
  if ((enabled & 16) &&
      (regs->pc == 0x8003c45c || regs->pc == 0x8003c484 || regs->pc == 0x8003c7f0)) {
    const unsigned players = ram32(0x800d6a10);
    if (players >= 2 && players <= 4) {
      /* Initialize and fill PAL's fixed tread buffers on every room peer.
       * Keep the original recorder's surface, contact and spacing checks. */
      /* Change the constant operand of each branch. The interpreter still
       * has the player count in a pending MIPS load at these instructions. */
      if (regs->pc == 0x8003c45c) regs->GPR.n.v0 = players;
      if (regs->pc == 0x8003c7f0 && tread_ring_ready(regs->GPR.n.t6)) regs->GPR.n.v1 = players;
      if (regs->pc == 0x8003c484) {
        /* Reproduce the tint sequence without consuming the game's RNG. */
        uint32_t seed = ram32(0x800ec148);
        const unsigned index = 2 * regs->GPR.n.s4 + regs->GPR.n.s5;
        for (unsigned i = 0; i <= index; ++i) seed = seed * 0x41c64e6du + 0x3039u;
        regs->GPR.n.v0 = (seed >> 16) & 0x7fff;
        regs->pc += 8; // The skipped call has a NOP delay slot.
        return 1;
      }
    }
    return 0;
  }
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
  advance_speedometers(players);
  advance_award_popups(players);
  advance_finish_popups(players);
  hud_advanced = 1;
  regs->pc = regs->GPR.n.ra;
  return 1;
}

static void center_hud_popup(enum hud_popup popup) {
  int left = INT16_MAX, right = INT16_MIN, top = INT16_MAX, bottom = INT16_MIN;
  for (unsigned index = 0; index < hud_count; ++index) {
    if (hud_popup[index] != popup) continue;
    for (unsigned vertex = 1; vertex < 9; vertex += 2) {
      const int x = (int16_t)hud_words[index][vertex];
      const int y = (int16_t)(hud_words[index][vertex] >> 16);
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (left > right) return;
  const int dx = (512 - left - right) / 2;
  const int dy = popup == HUD_FINISH ? (256 - top - bottom) / 2 : 0;
  for (unsigned index = 0; index < hud_count; ++index) {
    if (hud_popup[index] != popup) continue;
    for (unsigned vertex = 1; vertex < 9; vertex += 2) {
      uint32_t *xy = &hud_words[index][vertex];
      const uint16_t y = (int16_t)(*xy >> 16) + dy;
      *xy = ((uint32_t)y << 16) | (uint16_t)((int16_t)*xy + dx);
    }
  }
}

static void build_local_hud(void) {
  const unsigned gp = 0x800c1f18;
  unsigned table = hud_packet_table(), context = ram32(0x800c3cb8), rank = ram32(gp + 0x1ff0);
  hud_count = hud_error = 0;
  award_first = award_end = 0;
  finish_first = finish_end = 0;
  if (!table || context < 0x80000000
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
  if (hud_advanced) {
    word(RACER_BASE + RACER_AWARD, award_before[seat].event);
    set_half(AWARD_LATCH, award_before[seat].latch);
    set_half(AWARD_DISPLAY, award_before[seat].display);
    word(AWARD_TICKS, award_before[seat].ticks);
  } else {
    set_half(AWARD_LATCH, half(AWARD_LATCH + seat * 2));
    set_half(AWARD_DISPLAY, half(AWARD_DISPLAY + seat * 2));
    word(AWARD_TICKS, ram32(AWARD_TICKS + seat * 4));
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
    while (address < 0x200000 && budget > 0) {
      --budget;
      unsigned tag = ram32(address);
      if (is_hud_packet(address, tag >> 24, table, end)) {
        if (hud_count == 256) { hud_error = 4; break; }
        unsigned entry = (address - table) / 80;
        hud_popup[hud_count] = entry >= finish_first && entry < finish_end ? HUD_FINISH
          : entry >= award_first && entry < award_end ? HUD_AWARD : HUD_STATIC;
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
  else {
    center_hud_popup(HUD_AWARD);
    center_hud_popup(HUD_FINISH);
  }
}
void sled_view_configure(unsigned slot, unsigned flags) {
  seat = slot;
  enabled = flags;
#ifdef __EMSCRIPTEN__
  adaptive_distance(0, 0);
  presented_personal = hold_frame = 0;
  missed_personal_frames = 0;
  presented_wide = missed_wide_frames = 0;
  next_recovery_preview_ms = 0;
#endif
}
unsigned sled_view_status(unsigned field) {
  switch (field) {
    case 0: return used; case 1: return drawn; case 2: return overflow;
    case 3: return frames; case 4: return first_clip; case 5: return last_clip;
    case 6: return hud_count; case 7: return hud_error;
    case 8: return native_frames; case 9: return native_error; case 10: return native_pc;
    case 11: return native_cursor; case 12: return native_packets;
    case 13: return native_rank; case 14: return native_mode;
    case 15: return canonical_packets; case 16: return submission_packets;
    case 17: return native_range; case 19: return native_treads;
#ifdef __EMSCRIPTEN__
    case 18: return native_passes;
#endif
    default: return 0;
  }
}
void sled_view_begin(void) {
#ifdef __EMSCRIPTEN__
  sled_wide_gpu_ready = 0;
  enhanced_frame = NULL;
  wide_frame = NULL;
  wide_enhanced_frame = NULL;
  wide_pending = 0;
  hold_frame = 0;
  native_passes = 0;
#endif
  used = overflow = drawn = 0;
  native_treads = 0;
  render_captured = solo_hud_captured = 0;
  hud_advanced = 0;
  unsigned players = ram32(0x800d6a10);
#ifdef __EMSCRIPTEN__
  const int wide = EM_ASM_INT({ return !!Module.sledWidescreen; });
  wide_requested = wide;
  view_diagnostics = EM_ASM_INT({ return !!Module.sledViewDiagnostics; });
  const int enhanced = EM_ASM_INT({ return !!Module.sledEnhancedGraphics; });
  const int extended_distance = EM_ASM_INT({ return !!Module.sledDrawDistance; });
  const int presentation_mode = EM_ASM_INT({
    const replay = Module._sled_netplay_status && Module._sled_netplay_status(3);
    const hidden = Module.sledDedicatedClient && document.hidden;
    const recovering = Module.sledDedicatedClient && Module.sledCatchup;
    return (replay || hidden ? 1 : 0) | (recovering ? 2 : 0);
  });
  if (!(presentation_mode & RECOVERING)) next_recovery_preview_ms = 0;
  /* A visible wide view can show an occasional fresh frame as we catch up.
   * Only start the interval once the game has supplied a new wide frame. */
  recovery_preview = (presentation_mode & RECOVERING) &&
    !(presentation_mode & BLOCK_PRESENTATION) && wide && presented_wide &&
    emscripten_get_now() >= next_recovery_preview_ms;
  if (recovery_preview) {
    recovery_backlog = EM_ASM_INT({ return Module._sled_netplay_status(5); });
    /* Keep showing progress without spending render time on a growing backlog. */
    if (next_recovery_preview_ms &&
        (recovery_backlog >= last_recovery_preview_backlog ||
         last_recovery_preview_backlog - recovery_backlog < RECOVERY_PREVIEW_PROGRESS_FRAMES))
      recovery_preview = 0;
  }
  const int skip_presentation = presentation_mode && !recovery_preview;
  skip_personal = skip_presentation;
#else
  const int wide = 0;
  const int enhanced = 0;
  const int extended_distance = 0;
  const int skip_presentation = 0;
#endif
  solo_render = (wide || enhanced || extended_distance) && (enabled & 32) && players == 1;
  if (solo_render) hud_count = hud_error = 0;
  recording = !skip_presentation && (personal_scene(players) ||
    (solo_render && seat == 0 && ram32(0x800d6980) == 1 && !ram32(0x800c3ca0) && !ram32(0x800c34e0)));
#ifdef __EMSCRIPTEN__
  wide_pending = recording && wide && ((enabled & 4) || solo_render);
#endif
}
void sled_view_record(const uint32_t *words, unsigned count) {
  /* Solo falls back to the canonical picture, never to split-screen replay. */
  if (solo_render) return;
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
#ifdef __EMSCRIPTEN__
static int retain_wide_frame(int wide_race) {
  if (!wide_race || !presented_wide) return 0;
  /* Catch-up may skip drawing for several steps. For a renderer failure,
   * only hold briefly before allowing a live stock frame instead. */
  if (skip_personal || recovery_preview || missed_wide_frames++ < 12) return (hold_frame = 1);
  presented_wide = 0;
  return 0;
}
#endif
void sled_view_present(void) {
  const unsigned players = ram32(0x800d6a10);
  const int personal_race = personal_scene(players);
  const int pause_view = personal_race && ram32(0x800c34e0) == 1;
#ifdef __EMSCRIPTEN__
  const int active_race = ram32(0x800d6980) == 1 && !ram32(0x800c3ca0) && !ram32(0x800c34e0);
  const int wide_race = wide_requested && active_race &&
    (((enabled & 32) && players == 1 && seat == 0) || (personal_race && (enabled & 4)));
  if (pause_view) wide_pending = 0;
  const int skip_view = skip_personal || (gpu.status & PSX_GPU_STATUS_BLANKING);
  if (!wide_race) presented_wide = missed_wide_frames = 0;
  if (!personal_race) {
    presented_personal = 0;
    missed_personal_frames = 0;
  }
  if (skip_view && retain_wide_frame(wide_race)) return;
  if (skip_view && personal_race) {
    /* A skipped presentation must never leak the shared framebuffer to a
     * personal camera. Keep the last view until local drawing resumes. */
    hold_frame = presented_personal && (skip_personal || missed_personal_frames++ < 2);
    if (!hold_frame) presented_personal = 0;
    return;
  }
#endif
  if (!recording || (!solo_render && !personal_race) ||
      (solo_render && (!render_captured || !solo_hud_captured))) {
#ifdef __EMSCRIPTEN__
    if (!skip_view) retain_wide_frame(wide_race);
#endif
    return;
  }
#ifdef __EMSCRIPTEN__
  /* PAL does not submit new world geometry on every emulated step. Skip
   * private VRAM setup on those steps if we can keep the current wide view. */
  if (!render_captured && !skip_view && retain_wide_frame(wide_race)) return;
  if (render_captured && !skip_view && wide_race && presented_wide &&
      EM_ASM_INT({
        return Module.sledRenderRelief && Module.sledShouldHoldWideFrame &&
          Module.sledShouldHoldWideFrame() ? 1 : 0;
      })) {
    hold_frame = 1;
    return;
  }
  const int enhanced = EM_ASM_INT({ return !!Module.sledEnhancedGraphics; });
  const unsigned requested_distance = EM_ASM_INT({
    return Math.max(0, Math.min(100, Module.sledDrawDistance | 0));
  });
  /* The start camera sweeps through dense track scenery with the whole grid
   * in view. Leave the PAL geometry budget to the original scene until GO. */
  const unsigned distance_boost = adaptive_distance(
    (int32_t)ram32(RACER_BASE + RACER_RACE_CLOCK) > 0 ? requested_distance : 0,
    personal_race);
  const int match_solo = distance_match_solo;
  const unsigned trim_cells = distance_trim;
  unsigned hud_width = 0;
  EM_ASM({ if (Module.sledViewBefore) Module.sledViewBefore(); });
#else
  const unsigned distance_boost = 0;
  const unsigned trim_cells = 0;
  const int match_solo = 0;
#endif
  struct psx_gpu saved = gpu;
  memcpy(private_vram, gpu.vram, VRAM_BYTES);
  gpu.vram = private_vram;
  sled_renderer_set_vram(private_vram);
  replaying = 1;
  int base_y = -1;
  unsigned world_drawn = 0;
  first_clip = last_clip = 0;
  if (((enabled & 4) || solo_render) && saved.screen.src_y <= 256) {
    unsigned world_width = 512;
#ifdef __EMSCRIPTEN__
    if (!(saved.status & PSX_GPU_STATUS_RGB24)) {
      if (wide_pending) {
        wide_world = wide_cull = 1;
        world_width = SLED_WIDE_WIDTH;
        sled_renderer_set_widescreen(saved.vram);
        if (enhanced) sled_enhanced_wide_begin();
      }
      else if (enhanced)
        sled_enhanced_begin(saved.vram, saved.screen.src_y);
    }
#endif
    world_drawn = build_native_world(saved.screen.src_y, 0, world_width, match_solo, distance_boost, trim_cells);
#ifdef __EMSCRIPTEN__
    if (native_passes) adjust_distance(world_drawn, distance_boost);
    if (!world_drawn && (match_solo || distance_boost) && native_passes)
      world_drawn = build_native_world(saved.screen.src_y, 0, world_width, 0, 0, 0);
    if (world_drawn && wide_world && primitive_budget <= 0) {
      /* Even the stock range can exhaust the pool at 16:9. When adaptive
       * distance is enabled, shorten the next pass rather than redraw
       * the same dense scene twice on every frame. */
      if (distance_target && !match_solo && distance_trim < DISTANCE_MAX_TRIM) {
        ++distance_trim;
        distance_limit = distance_headroom = 0;
      }
      /* Extra terrain can exhaust the shared PAL primitive pool before
       * the game draws the racers. Clear the stock viewport and redraw
       * with the original culling. Keep the wide clip so sleds crossing
       * the old screen edge stay whole. */
      wide_cull = 0;
      sled_enhanced_wide_clear_center();
      world_drawn = build_native_world(saved.screen.src_y, SLED_WIDE_MARGIN, 512, 0, 0, 0);
    }
#endif
    if (world_drawn) {
      base_y = saved.screen.src_y;
    }
#ifdef __EMSCRIPTEN__
    else {
      if (wide_world) {
        sled_renderer_set_widescreen(NULL);
        sled_enhanced_wide_end(saved.vram, saved.screen.src_y, 0);
      }
      else sled_enhanced_end(0);
      wide_world = 0;
    }
#endif
  }

#ifdef __EMSCRIPTEN__
  /* Narrow replay can draw a valid personal camera, but must not replace
   * an established wide frame after one missed native presentation. */
  if (!wide_world && !skip_view) retain_wide_frame(wide_race);
  const unsigned replay_count = world_drawn || pause_view || solo_render || overflow || hold_frame ? 0 : used;
#else
  const unsigned replay_count = world_drawn || pause_view || solo_render || overflow ? 0 : used;
#endif
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
    /* PAL queues its pause menu before the world pass. Keep it in the
     * ordering table and omit the ordinary racing HUD while paused. */
    if (!pause_view && ((enabled & 2) || solo_render)) {
      if (!solo_render) build_local_hud();
#ifdef __EMSCRIPTEN__
      if (enhanced && hud_count) {
        hud_width = wide_world ? SLED_WIDE_WIDTH : 512;
        for (unsigned y = 0; y < 256; ++y)
          memcpy(hud_background + y * hud_width, private_vram + (base_y + y) * 1024,
                 hud_width * sizeof(*hud_background));
      }
#endif
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
#ifdef __EMSCRIPTEN__
    if (wide_world) wide_frame = private_vram + base_y * 1024;
    else
#endif
      vout_update();
    frames++;
  }
  gpu = saved;
  sled_renderer_set_vram(gpu.vram);
  renderer_sync_ecmds(gpu.ex_regs);
  replaying = 0;
#ifdef __EMSCRIPTEN__
  if (wide_frame && wide_race) {
    presented_wide = 1;
    missed_wide_frames = 0;
  }
  if (personal_race && !hold_frame) {
    if (world_drawn) {
      presented_personal = 1;
      missed_personal_frames = 0;
    } else if (presented_personal && missed_personal_frames++ < 2) {
      hold_frame = 1;
    } else {
      presented_personal = 0;
    }
  }
  uint16_t *enhanced_output = wide_world
    ? sled_enhanced_wide_end(saved.vram, saved.screen.src_y, 1) : sled_enhanced_end(1);
  if (sled_wide_gpu_ready && hud_width) {
    EM_ASM({ if (Module.sledWideGpuHud) Module.sledWideGpuHud($0, $1, $2); },
           hud_background, private_vram + base_y * 1024, hud_width);
  }
  if (hud_width) overlay_stock_hud(enhanced_output, private_vram + base_y * 1024, hud_width);
  if (wide_world) wide_enhanced_frame = enhanced_output;
  else enhanced_frame = enhanced_output;
  if (recovery_preview && wide_frame) {
    next_recovery_preview_ms = emscripten_get_now() + RECOVERY_PREVIEW_INTERVAL_MS;
    last_recovery_preview_backlog = recovery_backlog;
  }
  wide_world = 0;
  if (!wide_frame) wide_pending = 0;
  EM_ASM({ if (Module.sledViewAfter) Module.sledViewAfter(); });
#endif
}

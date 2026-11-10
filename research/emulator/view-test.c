/* Copyright (c) 2026 Vacho Aivazov. SPDX-License-Identifier: MIT */
#include "gpu.h"
#include "psxmem.h"
#include "r3000a.h"
#include "sled-view.h"
#include <assert.h>
#include <stdlib.h>
#include <string.h>

struct psx_gpu gpu;
s8 *psxM;
s8 *psxH;
R3000Acpu *psxCpu;
psxRegisters psxRegs;
static unsigned calls, offset, first_xy, hud_draws, fail_guest;
static int check_award;
static uint32_t expected_award, expected_ticks;
static int expected_award_quad;
static int check_finish, expected_finish_quad;
static unsigned expected_finish_ticks;
static int check_local_hud;
static unsigned local_seat, local_speed;
static const unsigned racer_base = 0x800dae20, racer_stride = 0x530;
static const unsigned finish_timer = 0x800a7400, racer_finished = 0x800dae20 + 0x35c;
static uint16_t canonical_vram[1024 * 512];
static unsigned cache_saved;
static const unsigned native_view = 0x800e2cb0, native_ot = 0x80020070;
static const unsigned snow_buffers[] = {0x80056000, 0x80057000};
static const unsigned snow_position = 30 | (0xffe0u << 16);
static unsigned native_seat, native_submissions;
void sled_view_cache_save(int restore) {
  if (restore) { assert(cache_saved); cache_saved = 0; }
  else { assert(!cache_saved); cache_saved = 1; }
}
void sled_renderer_set_vram(void *pointer) { assert(pointer == gpu.vram); }
void renderer_sync_ecmds(uint32_t *env) { memcpy(gpu.ex_regs, env, sizeof(gpu.ex_regs)); }
int do_cmd_list(uint32_t *words, int count, int *sum, int *cycles, int *command) {
  if (count == 9) {
    assert(words[0] == 0x2c808080);
    const int centered = expected_award_quad || expected_finish_quad;
    assert((uint16_t)words[1] == (centered ? 241 : 120));
    assert((uint16_t)words[3] == (centered ? 271 : 150));
    assert(words[1] >> 16 == (expected_finish_quad ? 120 : 50));
    hud_draws++;
    return count;
  }
  assert(count == 4 && words[0] == 0x200000ff);
  calls++; offset = gpu.ex_regs[5] & 2047;
  first_xy = words[1];
  gpu.vram[0] = 0xffff;
  return count;
}
long GPUdmaChain(uint32_t *ram, uint32_t start, uint32_t *progress, int32_t *cycles) {
  assert(sled_view_transaction == 2 && gpu.vram != canonical_vram);
  assert(start == native_ot);
  native_submissions++;
  return 0;
}
int vout_update(void) {
  assert(gpu.vram != canonical_vram);
  assert(gpu.screen.w == 512 && gpu.screen.h == 256);
  return 1;
}
static void word(unsigned address, unsigned value) { memcpy(psxM + (address & 0x1fffff), &value, 4); }
static unsigned read_word(unsigned address) { unsigned value; memcpy(&value, psxM + (address & 0x1fffff), 4); return value; }
static void simulate_world(psxRegisters *regs, enum blockExecCaller caller) {
  assert(sled_view_transaction == 2);
  switch (regs->pc) {
    case 0x8005aea0:
      assert(read_word(0x800d6a10) == 1);
      assert(regs->GPR.n.a0 == native_view);
      assert(regs->GPR.n.a1 == 0x80030000 + native_seat * 0x110);
      for (unsigned i = 0; i < 3; ++i)
        word(native_view + 0x144 + 4 * i, 0);
      word(native_view + 0x158, 0x01000200);
      word(native_view + 0x20c, 256);
      word(native_view + 0x210, 128);
      break;
    case 0x80079dec:
      assert(read_word(0x800d6a10) == 4);
      for (unsigned i = 0; i < 3; ++i)
        assert(read_word(native_view + 0x144 + 4 * i) == 0x80040000 + 12 * i);
      break;
    case 0x80051010: {
      regs->pc = 0x8003d100;
      regs->CP2C.n.h = 200;
      for (unsigned i = 16; i <= 19; ++i) regs->CP2D.p[i].w.l = 101;
      regs->CP2D.r[12] = 128u << 16;
      assert(!sled_view_pc(regs));
      regs->CP2D.r[12] = 129u << 16;
      assert(sled_view_pc(regs) && regs->pc == 0x8003d168);
      regs->pc = 0x8003d100;
      regs->CP2D.r[12] = 0;
      regs->CP2D.p[19].w.l = 100;
      assert(sled_view_pc(regs) && regs->pc == 0x8003d168);
      regs->pc = 0x8004ede4;
      regs->GPR.n.a0 = 0;
      assert(!sled_view_pc(regs) && regs->GPR.n.a0 == native_seat);
      const unsigned first = native_seat * 50, end = first + 50;
      const unsigned current = native_seat & 1;
      regs->pc = 0x80039c34;
      regs->GPR.n.a1 = first;
      regs->GPR.n.a2 = end;
      regs->CP2C.n.ofx = 256 << 16;
      regs->CP2C.n.ofy = 128 << 16;
      assert(!sled_view_pc(regs));
      for (unsigned i = 0; i < 200; ++i) {
        const unsigned offset = 20 * i + 8;
        const unsigned expected = i >= first && i < end ? 158 | (32 << 16) : snow_position;
        assert(read_word(snow_buffers[1 - current] + offset) == expected);
        assert(read_word(snow_buffers[current] + offset) == snow_position);
      }
      regs->pc = 0x80051e3c;
      regs->GPR.n.v0 = 1; // The stock comparison would continue the view loop.
      assert(!sled_view_pc(regs) && regs->GPR.n.v0 == 0);
      word(native_ot, 0x50000);
      for (unsigned i = 0; i < 5; ++i)
        word(0x50000 + 8 * i, 0x01000000 | (i == 4 ? 0xffffff : 0x50008 + 8 * i));
      break;
    }
    case 0x80085a6c:
    case 0x80053e8c:
      break;
    default:
      assert(0 && "unexpected native guest call");
  }
  regs->pc = regs->GPR.n.ra;
}
static void simulate_hud(psxRegisters *regs, enum blockExecCaller caller) {
  assert(sled_view_transaction && regs->GPR.n.gp == 0x800c1f18);
  assert(regs->GPR.n.sp == 0x801ff000 && !(regs->CP0.n.SR & 1));
  if (check_local_hud) {
    assert(read_word(racer_base) == 1000 + local_seat);
    assert(read_word(racer_base + 0x288) == local_speed);
    regs->pc = 0x80061eb0;
    assert(sled_view_pc(regs) && regs->pc == 0x80061f78);
    regs->pc = 0x80062948;
    assert(!sled_view_pc(regs));
    for (unsigned slot = 0; slot < 4; ++slot)
      assert(read_word(racer_base + slot * racer_stride) == 1000 + slot);
    regs->pc = 0x80062950;
    assert(!sled_view_pc(regs));
    assert(read_word(racer_base) == 1000 + local_seat);
    assert(read_word(racer_base + 0x288) == local_speed);
  }
  if (check_award) {
    assert(read_word(0x800dae20 + 0x514) == expected_award);
    assert(read_word(0x800e3928) == expected_ticks);
  }
  regs->cycle += 1234; regs->interrupt ^= 123;
  psxM[42] = 99;
  if (fail_guest) return;
  unsigned table = read_word(0x800c1f58), head = read_word(0x800c3cb8) + 0x70 + 7 * 4;
  if (expected_award_quad) {
    regs->pc = 0x80060dec;
    assert(!sled_view_pc(regs));
  }
  if (check_finish) {
    if (!expected_finish_quad) word(0x800c3f72, 1);
    regs->pc = 0x8006159c;
    assert(!sled_view_pc(regs));
    assert(read_word(0x800d6a10) == 1 && read_word(finish_timer) == 0);
    assert(read_word(racer_finished) == (unsigned)expected_finish_quad);
    if (expected_finish_quad) {
      regs->pc = 0x80061940;
      assert(!sled_view_pc(regs) && read_word(finish_timer) == expected_finish_ticks);
    }
  }
  word(table, (9 << 24) | (read_word(head) & 0xffffff));
  word(table + 4, 0x2c808080);
  word(table + 8, 120 | 50 << 16);
  word(table + 16, 150 | 50 << 16);
  word(table + 24, 120 | 65 << 16);
  word(table + 32, 150 | 65 << 16);
  word(head, table & 0xffffff);
  word(0x800c1f18 + 0x205a, 1);
  if (expected_award_quad) {
    regs->pc = 0x8006126c;
    assert(!sled_view_pc(regs));
  }
  if (check_finish) {
    regs->pc = 0x80061d14;
    assert(!sled_view_pc(regs));
  }
  regs->pc = regs->GPR.n.ra;
}
static void pane(unsigned x, unsigned right, unsigned y, unsigned bottom) {
  gpu.ex_regs[3] = 0xe3000000 | x | (y << 10);
  gpu.ex_regs[4] = 0xe4000000 | (bottom << 10) | right;
  gpu.ex_regs[5] = 0xe5000000 | x | (y << 11);
  uint32_t triangle[] = {0x200000ff, 16 | (32 << 16), 0, 0};
  sled_view_record(triangle, 4);
}
int main(void) {
  psxM = calloc(1, 0x200000);
  assert(psxM);
  word(0x800d6980, 1); word(0x800d6a10, 2);
  gpu.vram = canonical_vram;
  for (unsigned seat = 0; seat < 2; seat++) {
    calls = 0;
    sled_view_configure(seat, 1); sled_view_begin();
    pane(0, 255, 0, 255); pane(258, 511, 0, 255);
    struct psx_gpu saved = gpu;
    sled_view_present();
    assert(calls == 1 && offset == 128);
    assert(!memcmp(&saved, &gpu, sizeof(gpu)));
    assert(canonical_vram[0] == 0);
    assert(sled_view_status(1) == 1 && sled_view_status(2) == 0);
  }
  word(0x800d6a10, 4);
  calls = 0;
  sled_view_configure(0, 2 | 16); sled_view_begin();
  pane(0, 255, 256, 383); sled_view_present();
  assert(calls == 0 && sled_view_status(0) == 0);
  psxRegs.pc = 0x8004a41c;
  assert(sled_view_pc(&psxRegs) && psxRegs.pc == 0x8004a424);
  for (unsigned seat = 0; seat < 4; seat++) {
    calls = 0; sled_view_configure(seat, 1); sled_view_begin();
    pane(0, 255, 256, 383); pane(258, 511, 256, 383);
    pane(0, 255, 385, 511); pane(258, 511, 385, 511);
    struct psx_gpu saved = gpu;
    sled_view_present();
    assert(calls == 1 && offset == 0 && first_xy == (32 | (64 << 16)));
    assert(!memcmp(&saved, &gpu, sizeof(gpu)) && canonical_vram[0] == 0);
  }
  R3000Acpu stub_cpu = { .ExecuteBlock = simulate_world }; psxCpu = &stub_cpu;
  unsigned char *saved_ram = malloc(0x200000); assert(saved_ram);
  unsigned char scratch[0x400] = {0};
  psxH = (s8 *)scratch;
  word(0x800c3cb8, native_ot - 0x70);
  for (unsigned i = 0; i < 3; ++i)
    word(native_view + 0x144 + i * 4, 0x80040000 + i * 12);
  for (unsigned frame = 0; frame < 2; ++frame) {
    word(0x800c3cd8 + frame * 4, snow_buffers[frame]);
    for (unsigned i = 0; i < 200; ++i) word(snow_buffers[frame] + 20 * i + 8, snow_position);
  }
  for (native_seat = 0; native_seat < 4; ++native_seat) {
    word(0x800d6968, native_seat & 1);
    word(native_view + native_seat * 0x224 + 0x220, 0x80030000 + native_seat * 0x110);
    word(native_view + native_seat * 0x224 + 0x20c, 128);
    word(native_view + native_seat * 0x224 + 0x210, 64);
    memcpy(saved_ram, psxM, 0x200000);
    sled_view_configure(native_seat, 5);
    sled_view_begin();
    psxRegs.pc = 0x80014e88;
    assert(!sled_view_pc(&psxRegs));
    struct psx_gpu saved = gpu;
    sled_view_present();
    assert(native_submissions == native_seat + 1 && sled_view_status(9) == 0);
    assert(!memcmp(psxM, saved_ram, 0x200000) && !memcmp(&gpu, &saved, sizeof(gpu)));
    assert(psxRegs.pc == 0x80014e88 && !sled_view_transaction && !cache_saved);
  }
  psxRegs.pc = 0x80051e3c;
  psxRegs.GPR.n.v0 = 1;
  assert(!sled_view_pc(&psxRegs) && psxRegs.GPR.n.v0 == 1);
  psxRegs.pc = 0x8004ede4;
  psxRegs.GPR.n.a0 = 2;
  assert(!sled_view_pc(&psxRegs) && psxRegs.GPR.n.a0 == 2);
  word(0x800c34e0, 1);
  native_seat = 0;
  word(0x800d6968, 0);
  sled_view_configure(native_seat, 7); sled_view_begin();
  psxRegs.pc = 0x80014e88;
  assert(!sled_view_pc(&psxRegs));
  sled_view_present();
  assert(native_submissions == 5 && !sled_view_status(7) && !sled_view_status(9));
  word(0x800c34e0, 0);

  sled_view_configure(0, 2 | 16); sled_view_begin();
  psxRegs.pc = 0x8003c45c;
  psxRegs.GPR.n.v0 = 1;
  assert(!sled_view_pc(&psxRegs) && psxRegs.GPR.n.v0 == 4);
  word(0x800ec148, 1);
  psxRegs.pc = 0x8003c484;
  psxRegs.GPR.n.s4 = psxRegs.GPR.n.s5 = 0;
  assert(sled_view_pc(&psxRegs) && psxRegs.pc == 0x8003c48c);
  assert(psxRegs.GPR.n.v0 == 16838 && read_word(0x800ec148) == 1);
  psxRegs.pc = 0x8003c7f0;
  psxRegs.GPR.n.v1 = 1; psxRegs.GPR.n.t6 = 0;
  assert(!sled_view_pc(&psxRegs) && psxRegs.GPR.n.v1 == 1);
  word(0x800dd4b8, 0x800b0500);
  assert(!sled_view_pc(&psxRegs) && psxRegs.GPR.n.v1 == 4);
  stub_cpu.ExecuteBlock = simulate_hud;
  word(0x800c1f58, 0x80010000); word(0x800c3cb8, 0x80020000); word(0x800c1f18 + 0x1ff0, 7);
  psxRegs.pc = 0x80012340; psxRegs.CP0.n.SR = 0x401;
  memcpy(saved_ram, psxM, 0x200000); psxRegisters saved_regs = psxRegs;
  for (fail_guest = 0; fail_guest < 2; fail_guest++) {
    hud_draws = 0;
    sled_view_configure(0, 3); sled_view_begin(); pane(0, 255, 0, 127);
    struct psx_gpu saved = gpu; sled_view_present();
    assert(hud_draws == (fail_guest ? 0 : 1));
    assert(sled_view_status(7) == (fail_guest ? 2 : 0));
    assert(!sled_view_transaction && !cache_saved && !memcmp(&psxRegs, &saved_regs, sizeof(psxRegs)));
    assert(!memcmp(psxM, saved_ram, 0x200000) && !memcmp(&gpu, &saved, sizeof(gpu)));
  }
  fail_guest = 0;
  check_award = 1;
  const unsigned award = 0x800dae20 + 0x514, timer = 0x800e3928;
  for (unsigned seat = 0; seat < 4; ++seat) word(award + seat * 0x530, UINT32_MAX);
  for (unsigned frame = 0; frame <= 22; ++frame) {
    word(award + 2 * 0x530, frame ? UINT32_MAX : 100);
    sled_view_configure(2, 3);
    sled_view_begin();
    expected_award = frame ? UINT32_MAX : 100;
    expected_ticks = read_word(timer + 8);
    expected_award_quad = !frame || expected_ticks;
    psxRegs.pc = 0x800650fc;
    psxRegs.GPR.n.ra = 0x8006c7b0;
    assert(sled_view_pc(&psxRegs) && psxRegs.pc == psxRegs.GPR.n.ra);
    assert(read_word(timer) == 0);
    assert(read_word(timer + 8) == (frame < 3 ? 19 : frame < 21 ? 21 - frame : 0));
    assert((read_word(0x800c2f88 + 4) & 0xffff) == (frame < 3 ? (frame + 1) * 25 : 100));
    memcpy(saved_ram, psxM, 0x200000);
    pane(0, 255, 128, 255);
    sled_view_present();
    assert(sled_view_status(7) == 0);
    assert(!memcmp(psxM, saved_ram, 0x200000));
    // The same frame viewed from controller 1 cannot show controller 3's award.
    if (!frame) {
      const unsigned previous_draws = hud_draws;
      expected_award = UINT32_MAX;
      expected_ticks = expected_award_quad = 0;
      sled_view_configure(0, 3);
      pane(0, 255, 0, 127);
      sled_view_present();
      assert(hud_draws == previous_draws + 1);
    }
  }
  check_award = expected_award_quad = 0;
  check_finish = 1;
  word(racer_finished + 2 * 0x530, 1);
  const unsigned finish_ticks[] = {0, 12, 199, 200};
  for (unsigned frame = 0; frame < 4; ++frame) {
    expected_finish_ticks = finish_ticks[frame];
    word(finish_timer + 8, expected_finish_ticks);
    sled_view_configure(2, 3);
    sled_view_begin();
    psxRegs.pc = 0x800650fc;
    assert(sled_view_pc(&psxRegs) && psxRegs.pc == psxRegs.GPR.n.ra);
    assert(read_word(finish_timer + 8) == (frame < 3 ? expected_finish_ticks + 1 : 200));
    assert(read_word(finish_timer) == 0 && read_word(finish_timer + 4) == 0 && read_word(finish_timer + 12) == 0);
    memcpy(saved_ram, psxM, 0x200000);
    const unsigned previous_draws = hud_draws;
    expected_finish_quad = 1;
    pane(0, 255, 128, 255);
    sled_view_present();
    expected_finish_quad = 0;
    sled_view_configure(0, 3);
    pane(0, 255, 0, 127);
    sled_view_present();
    assert(hud_draws == previous_draws + 2 && sled_view_status(7) == 0);
    assert(!memcmp(psxM, saved_ram, 0x200000));
  }
  word(racer_finished + 2 * 0x530, 0);
  psxRegs.pc = 0x800650fc;
  assert(sled_view_pc(&psxRegs) && read_word(finish_timer + 8) == 0);
  check_finish = 0;
  check_local_hud = 1;
  for (unsigned slot = 0; slot < 4; ++slot) {
    word(racer_base + slot * racer_stride, 1000 + slot);
    word(racer_base + slot * racer_stride + 0x284, 99 + slot);
    word(racer_base + slot * racer_stride + 0x288, 0);
  }
  word(0x800a72d4 + 99, 0x0000aa96); // PAL curve entries 150 and 170.
  const unsigned expected_speed[2][4] = {{75, 85, 87, 87}, {82, 93, 95, 95}};
  for (unsigned tick = 0; tick < 2; ++tick) {
    word(0x800c2824, tick); // Change from km/h to mph between canonical ticks.
    sled_view_configure(0, 2 | 16); sled_view_begin();
    psxRegs.pc = 0x800650fc;
    assert(sled_view_pc(&psxRegs));
    for (local_seat = 0; local_seat < 4; ++local_seat) {
      local_speed = expected_speed[tick][local_seat];
      assert(read_word(racer_base + local_seat * racer_stride + 0x288) == local_speed);
      memcpy(saved_ram, psxM, 0x200000);
      sled_view_configure(local_seat, 3);
      pane(256 * (local_seat & 1), 255 + 256 * (local_seat & 1),
           128 * (local_seat >> 1), 127 + 128 * (local_seat >> 1));
      sled_view_present();
      assert(sled_view_status(7) == 0 && !memcmp(psxM, saved_ram, 0x200000));
    }
  }
  check_local_hud = 0;
  free(saved_ram);
  word(0x800c34e0, 1); calls = 0;
  sled_view_begin(); pane(0, 255, 0, 255); sled_view_present();
  assert(calls == 0); // Original pause menus bypass presentation replay.
  free(psxM);
  return 0;
}

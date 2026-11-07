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
static uint32_t expected_award;
static uint16_t canonical_vram[1024 * 512];
static unsigned cache_saved;
void sled_view_cache_save(int restore) {
  if (restore) { assert(cache_saved); cache_saved = 0; }
  else { assert(!cache_saved); cache_saved = 1; }
}
void sled_renderer_set_vram(void *pointer) { assert(pointer == gpu.vram); }
void renderer_sync_ecmds(uint32_t *env) { memcpy(gpu.ex_regs, env, sizeof(gpu.ex_regs)); }
int do_cmd_list(uint32_t *words, int count, int *sum, int *cycles, int *command) {
  if (count == 9) { assert(words[0] == 0x2c808080); hud_draws++; return count; }
  assert(count == 4 && words[0] == 0x200000ff);
  calls++; offset = gpu.ex_regs[5] & 2047;
  first_xy = words[1];
  gpu.vram[0] = 0xffff;
  return count;
}
long GPUdmaChain(uint32_t *ram, uint32_t start, uint32_t *progress, int32_t *cycles) {
  assert(0 && "native renderer must be explicitly enabled");
  return 0;
}
int vout_update(void) {
  assert(gpu.vram != canonical_vram);
  assert(gpu.screen.w == 512 && gpu.screen.h == 256);
  return 1;
}
static void word(unsigned address, unsigned value) { memcpy(psxM + (address & 0x1fffff), &value, 4); }
static unsigned read_word(unsigned address) { unsigned value; memcpy(&value, psxM + (address & 0x1fffff), 4); return value; }
static void simulate_hud(psxRegisters *regs, enum blockExecCaller caller) {
  assert(sled_view_transaction && regs->GPR.n.gp == 0x800c1f18);
  assert(regs->GPR.n.sp == 0x801ff000 && !(regs->CP0.n.SR & 1));
  if (check_award) assert(read_word(0x800dae20 + 0x514) == expected_award);
  regs->cycle += 1234; regs->interrupt ^= 123;
  psxM[42] = 99;
  if (fail_guest) return;
  unsigned table = read_word(0x800c1f58), head = read_word(0x800c3cb8) + 0x70 + 7 * 4;
  word(table, (9 << 24) | (read_word(head) & 0xffffff));
  word(table + 4, 0x2c808080);
  word(head, table & 0xffffff);
  word(0x800c1f18 + 0x205a, 1);
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
  R3000Acpu stub_cpu = { .ExecuteBlock = simulate_hud }; psxCpu = &stub_cpu;
  word(0x800c1f58, 0x80010000); word(0x800c3cb8, 0x80020000); word(0x800c1f18 + 0x1ff0, 7);
  psxRegs.pc = 0x80012340; psxRegs.CP0.n.SR = 0x401;
  unsigned char *saved_ram = malloc(0x200000); assert(saved_ram);
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
    psxRegs.pc = 0x800650fc;
    psxRegs.GPR.n.ra = 0x8006c7b0;
    assert(sled_view_pc(&psxRegs));
    assert(read_word(timer) == 0);
    assert(read_word(timer + 8) == (frame < 3 ? 20 : 22 - frame));
    expected_award = frame == 22 ? UINT32_MAX : frame < 3 ? (frame + 1) * 25 : 100;
    memcpy(saved_ram, psxM, 0x200000);
    pane(0, 255, 128, 255);
    sled_view_present();
    assert(sled_view_status(7) == 0);
    assert(!memcmp(psxM, saved_ram, 0x200000));
    // The same frame viewed from controller 1 cannot show controller 3's award.
    if (!frame) {
      const unsigned previous_draws = hud_draws;
      expected_award = UINT32_MAX;
      sled_view_configure(0, 3);
      pane(0, 255, 0, 127);
      sled_view_present();
      assert(hud_draws == previous_draws + 1);
    }
  }
  free(saved_ram);
  word(0x800c34e0, 1); calls = 0;
  sled_view_begin(); pane(0, 255, 0, 255); sled_view_present();
  assert(calls == 0); // Original pause menus bypass presentation replay.
  free(psxM);
  return 0;
}

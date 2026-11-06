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
R3000Acpu *psxCpu;
static unsigned calls, offset;
static uint16_t canonical_vram[1024 * 512];
void sled_renderer_set_vram(void *pointer) { assert(pointer == gpu.vram); }
void renderer_sync_ecmds(uint32_t *env) { memcpy(gpu.ex_regs, env, sizeof(gpu.ex_regs)); }
int do_cmd_list(uint32_t *words, int count, int *sum, int *cycles, int *command) {
  assert(count == 4 && words[0] == 0x200000ff);
  calls++; offset = gpu.ex_regs[5] & 2047;
  gpu.vram[0] = 0xffff;
  return count;
}
int vout_update(void) {
  assert(gpu.vram != canonical_vram);
  assert(gpu.screen.w == 512 && gpu.screen.h == 256);
  return 1;
}
static void word(unsigned address, unsigned value) { memcpy(psxM + (address & 0x1fffff), &value, 4); }
static void pane(unsigned x, unsigned right) {
  gpu.ex_regs[3] = 0xe3000000 | x;
  gpu.ex_regs[4] = 0xe4000000 | (255 << 10) | right;
  gpu.ex_regs[5] = 0xe5000000 | x;
  uint32_t triangle[] = {0x200000ff, 0, 0, 0};
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
    pane(0, 255); pane(258, 511);
    struct psx_gpu saved = gpu;
    sled_view_present();
    assert(calls == 1 && offset == 128);
    assert(!memcmp(&saved, &gpu, sizeof(gpu)));
    assert(canonical_vram[0] == 0);
    assert(sled_view_status(1) == 1 && sled_view_status(2) == 0);
  }
  word(0x800c34e0, 1); calls = 0;
  sled_view_begin(); pane(0, 255); sled_view_present();
  assert(calls == 0); // Original pause menus bypass presentation replay.
  free(psxM);
  return 0;
}

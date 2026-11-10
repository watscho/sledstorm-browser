/* Copyright (c) 2026 Vacho Aivazov. SPDX-License-Identifier: GPL-2.0-or-later
 * A second instance of PCSX-ReARMed's upstream 2x rasterizer for presentation. */
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>
#include "sled-view.h"

#define gpu enhanced_gpu
#define do_cmd_list enhanced_cmd_list
#define renderer_init enhanced_init
#define renderer_finish enhanced_finish
#define renderer_sync_ecmds enhanced_sync_ecmds
#define renderer_update_caches enhanced_update_caches
#define renderer_flush_queues enhanced_flush_queues
#define renderer_set_interlace enhanced_set_interlace
#define renderer_set_config enhanced_set_config
#define renderer_notify_res_change enhanced_notify_res_change
#define renderer_notify_scanout_change enhanced_notify_scanout_change
#define renderer_notify_update_lace enhanced_notify_update_lace
#define renderer_sync enhanced_sync
#include "../plugins/gpu_neon/psx_gpu_if.c"

struct psx_gpu enhanced_gpu;
static uint16_t *texture_vram;
static unsigned active;
enum { TILE_WIDTH = SLED_WIDE_WIDTH / 2, WIDE_PACKETS = 16384, WIDE_WORDS = 262144 };
typedef struct {
  uint32_t env[8];
  unsigned start, count;
} DrawPacket;
static DrawPacket wide_packets[WIDE_PACKETS];
static uint32_t wide_words[WIDE_WORDS];
static unsigned packets_used, words_used, clear_before;
static int recording_wide, wide_overflow;
int sled_wide_gpu_capture;
int sled_wide_gpu_ready;
static uint16_t wide_output[SLED_WIDE_2X_WIDTH * 512];

static void *allocate_buffer(unsigned size) { return calloc(1, size); }
static void free_buffer(void *pointer, unsigned size) { (void)size; free(pointer); }

static void begin_enhancement(const uint16_t *vram, unsigned y, unsigned width) {
  active = 0;
  if (!texture_vram) {
    // Match GPULib's guard space and SIMD alignment for overdraw and texture reads.
    void *allocation = calloc(2 * 1024 * 512 * sizeof(*texture_vram) + 4096 + 63, 1);
    if (!allocation) return;
    texture_vram = (uint16_t *)(((uintptr_t)allocation + 4096 + 63) & ~(uintptr_t)63);
    gpu.vram = texture_vram;
    gpu.mmap = allocate_buffer;
    gpu.munmap = free_buffer;
    renderer_init();
  }
  if (!gpu.get_enhancement_bufer) return;
  memcpy(texture_vram, vram, 1024 * 512 * sizeof(*vram));
  for (unsigned row = y; row < y + 256; ++row)
    memset(texture_vram + row * 1024, 0, width * sizeof(*vram));
  gpu.screen.src_x = 0;
  gpu.screen.src_y = y;
  gpu.screen.hres = gpu.screen.w = width;
  gpu.screen.vres = gpu.screen.h = 256;
  gpu.state.enhancement_active = 1;
  renderer_update_caches(0, 0, 1024, 512, 1);
  active = 1;
}

void sled_enhanced_begin(const uint16_t *vram, unsigned y) {
  sled_wide_gpu_capture = 0;
  begin_enhancement(vram, y, 512);
}

void sled_enhanced_wide_begin(void) {
  packets_used = words_used = 0;
  clear_before = WIDE_PACKETS;
  wide_overflow = 0;
  recording_wide = 1;
  sled_wide_gpu_capture = EM_ASM_INT({ return typeof Module.sledWideGpuCapture === 'function'; });
}

void sled_enhanced_wide_clear_center(void) {
  if (recording_wide) clear_before = packets_used;
}

void sled_enhanced_draw(uint32_t *words, int count, uint32_t *env) {
  if (recording_wide) {
    if (count <= 0 || wide_overflow) return;
    if (packets_used == WIDE_PACKETS || (unsigned)count > WIDE_WORDS - words_used) {
      wide_overflow = 1;
      return;
    }
    DrawPacket *packet = &wide_packets[packets_used++];
    memcpy(packet->env, env, sizeof(packet->env));
    packet->start = words_used;
    packet->count = count;
    memcpy(wide_words + words_used, words, count * sizeof(*words));
    words_used += count;
    return;
  }
  if (!active) return;
  renderer_sync_ecmds(env);
  int cycles = 0, last = 0, command = 0;
  do_cmd_list(words, count, &cycles, &last, &command);
}

uint16_t *sled_enhanced_end(unsigned present) {
  if (!active) return NULL;
  active = 0;
  renderer_flush_queues();
  if (!present) return NULL;
  int x = 0, y = gpu.screen.src_y, w = gpu.screen.w, h = 256, height;
  uint16_t *pixels = gpu.get_enhancement_bufer(&x, &y, &w, &h, &height);
  return pixels && y + h <= height ? pixels + y * 1024 + x : NULL;
}

static uint32_t tile_command(uint32_t word, unsigned left) {
  if ((word >> 24) == 0xe4 && (word & 1023) == 511)
    return (word & ~1023u) | (TILE_WIDTH - 1);
  if ((word >> 24) == 0xe5 && (word & 2047) == 0)
    return word | ((SLED_WIDE_MARGIN - left) & 2047u);
  return word;
}

static int render_tile(const uint16_t *vram, unsigned y, unsigned left) {
  begin_enhancement(vram, y, TILE_WIDTH);
  if (!active) return 0;
  for (unsigned index = 0; index < packets_used; ++index) {
    const DrawPacket *packet = &wide_packets[index];
    if (index == clear_before) {
      renderer_flush_queues();
      int x = 0, row = y, w = TILE_WIDTH, h = 256, height;
      uint16_t *pixels = gpu.get_enhancement_bufer(&x, &row, &w, &h, &height);
      if (!pixels || row + h > height) { sled_enhanced_end(0); return 0; }
      const unsigned first = left ? 0 : SLED_WIDE_MARGIN * 2;
      const unsigned end = left ? (TILE_WIDTH - SLED_WIDE_MARGIN) * 2 : TILE_WIDTH * 2;
      for (int line = row; line < row + h; ++line)
        memset(pixels + line * 1024 + first, 0, (end - first) * sizeof(*pixels));
    }
    uint32_t env[8], words[256];
    if (packet->count > sizeof(words) / sizeof(*words)) { sled_enhanced_end(0); return 0; }
    memcpy(env, packet->env, sizeof(env));
    env[4] = tile_command(env[4], left);
    env[5] = tile_command(env[5], left);
    memcpy(words, wide_words + packet->start, packet->count * sizeof(*words));
    for (unsigned i = 0; i < packet->count;) {
      unsigned command = words[i] >> 24;
      if ((command & 0xe8) == 0x48) { sled_enhanced_end(0); return 0; }
      words[i] = tile_command(words[i], left);
      i += 1 + cmd_lengths[command];
    }
    sled_enhanced_draw(words, packet->count, env);
  }
  const uint16_t *pixels = sled_enhanced_end(1);
  if (!pixels) return 0;
  for (unsigned row = 0; row < 512; ++row)
    memcpy(wide_output + row * SLED_WIDE_2X_WIDTH + left * 2,
           pixels + row * 1024, TILE_WIDTH * 2 * sizeof(*pixels));
  return 1;
}

uint16_t *sled_enhanced_wide_end(const uint16_t *vram, unsigned y, int present) {
  if (!recording_wide) return NULL;
  recording_wide = 0;
  const int gpu_capture = sled_wide_gpu_capture;
  sled_wide_gpu_capture = 0;
  if (!present || wide_overflow || !packets_used) return NULL;
  if (gpu_capture && EM_ASM_INT({
    return Module.sledWideGpuCapture($0, $1, $2, $3, $4, $5, $6) ? 1 : 0;
  }, vram, y, wide_packets, packets_used, wide_words, words_used, clear_before)) {
    sled_wide_gpu_ready = 1;
    return NULL;
  }
  egpu.hack_disable_main = 1;
  const int rendered = render_tile(vram, y, 0) && render_tile(vram, y, TILE_WIDTH);
  egpu.hack_disable_main = 0;
  return rendered ? wide_output : NULL;
}

/* Scale stock video after scanout. Matching neighbors extend diagonal edges
 * without blurring straight lines or changing the emulated GPU state. */
#define SCALE_ROWS(type) do {                                                       \
  type *output = scaled;                                                            \
  const unsigned stride = pitch / sizeof(type);                                     \
  for (unsigned y = 0; y < height; ++y) {                                           \
    const type *row = (const type *)pixels + y * stride;                            \
    const type *above = y ? row - stride : row;                                     \
    const type *below = y + 1 < height ? row + stride : row;                         \
    type *upper = output + 4 * y * width, *lower = upper + 2 * width;                \
    for (unsigned x = 0; x < width; ++x) {                                          \
      const type center = row[x], top = above[x], bottom = below[x];                \
      const type left = x ? row[x - 1] : center;                                    \
      const type right = x + 1 < width ? row[x + 1] : center;                        \
      const int edge = top != bottom && left != right;                             \
      upper[2 * x]     = edge && left == top ? left : center;                       \
      upper[2 * x + 1] = edge && right == top ? right : center;                     \
      lower[2 * x]     = edge && left == bottom ? left : center;                    \
      lower[2 * x + 1] = edge && right == bottom ? right : center;                  \
    }                                                                              \
  }                                                                                \
} while (0)

const void *sled_scale_frame_2x(const void *pixels, unsigned width, unsigned height, unsigned pitch, unsigned bytes_per_pixel) {
  static void *scaled;
  if (!pixels || !width || !height || width > 1024 || height > 512) return NULL;
  if (!scaled) scaled = malloc(2048 * 1024 * sizeof(uint32_t));
  if (!scaled) return NULL;
  if (bytes_per_pixel == 4) SCALE_ROWS(uint32_t);
  else SCALE_ROWS(uint16_t);
  return scaled;
}
#undef SCALE_ROWS

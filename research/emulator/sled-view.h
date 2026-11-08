/* Copyright (c) 2026 Vacho Aivazov. SPDX-License-Identifier: MIT */
#ifndef SLED_VIEW_H
#define SLED_VIEW_H
#include <stdint.h>
void sled_view_configure(unsigned seat, unsigned flags);
unsigned sled_view_status(unsigned field);
void sled_view_begin(void);
void sled_view_record(const uint32_t *words, unsigned count);
void sled_view_present(void);
struct psxRegisters;
int sled_view_pc(struct psxRegisters *registers);
extern int sled_view_transaction;
extern int sled_view_hardware_access;
void sled_view_cache_save(int restore);
#ifdef __EMSCRIPTEN__
#define SLED_WIDE_WIDTH  684
#define SLED_WIDE_MARGIN ((SLED_WIDE_WIDTH - 512) / 2)
#define SLED_WIDE_2X_WIDTH (SLED_WIDE_WIDTH * 2)
int sled_view_wide_pending(void);
const uint16_t *sled_view_wide_frame(void);
const uint16_t *sled_view_wide_enhanced_frame(void);
void sled_renderer_set_widescreen(const void *texture_vram);
void sled_enhanced_begin(const uint16_t *vram, unsigned y);
void sled_enhanced_wide_begin(void);
void sled_enhanced_wide_clear_center(void);
uint16_t *sled_enhanced_wide_end(const uint16_t *vram, unsigned y, int present);
void sled_enhanced_draw(uint32_t *words, int count, uint32_t *env);
uint16_t *sled_enhanced_end(unsigned present);
const uint16_t *sled_view_enhanced_frame(void);
const void *sled_scale_frame_2x(const void *pixels, unsigned width, unsigned height, unsigned pitch, unsigned bytes_per_pixel);
#endif
#endif

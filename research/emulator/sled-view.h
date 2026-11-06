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
#endif

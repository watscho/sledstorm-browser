#pragma once
#include <stdint.h>
void sled_web_hud_tag(void);
int sled_web_hud_shared(uint32_t primitive);
int sled_web_hud_transform(uint32_t primitive, int copy, int32_t x[4], int32_t y[4]);
struct CPUState;
int sled_web_single_hud(struct CPUState *cpu);
int sled_web_hud_owned(uint32_t primitive);

int sled_web_two_player_view(void);

int sled_web_menu_active(void);

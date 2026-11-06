#pragma once
#include "cpu_state.h"
#ifdef __cplusplus
extern "C" {
#endif
int sled_web_online_enabled(void);
int sled_web_online_slot(void);
int sled_web_replaying(void);
void sled_web_bind_cpu(CPUState *cpu);
void sled_web_sync_frame(void);
void sled_online_configure(int slot);
uint32_t sled_online_tick(void);
void sled_web_camera_present(CPUState *cpu);
int sled_web_camera_mode(void);
#ifdef __cplusplus
}
#endif

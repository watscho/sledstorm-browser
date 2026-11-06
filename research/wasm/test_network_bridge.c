#include "web_network.h"
#include "web_controllers.h"
#include "web_progress.h"
#include "netplay_state_digest.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
static uint16_t row[4];
void sled_web_progress_tick(void) {}
uint32_t netplay_core_digest(const CPUState *cpu) { (void)cpu; return 0x1234u + sled_online_tick(); }
void sled_web_apply_controller_row(const uint16_t pads[4]) { memcpy(row, pads, sizeof(row)); }
int main(void) {
 static CPUState cpu;
 sled_web_bind_cpu(&cpu);
 sled_online_configure(0);
 for(unsigned tick=0;tick<200;++tick) {
  sled_web_sync_frame();
  assert(sled_online_tick()==tick+1);
  for(unsigned i=0;i<4;++i) assert(row[i]==tick+i);
 }
 puts("NETWORK_BRIDGE_PASSED");
}

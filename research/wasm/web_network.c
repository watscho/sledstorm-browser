#include "web_network.h"
#include "web_progress.h"
#include "web_controllers.h"
#include "netplay_state_digest.h"
#include "sio.h"
#include <emscripten/emscripten.h>
#include <stdint.h>
#include <stdlib.h>

static CPUState *bound_cpu;
static int online;
static int local_slot;
static uint32_t tick;
static uint32_t last_digest;

EMSCRIPTEN_KEEPALIVE void sled_online_configure(int slot) {
    if (slot < 0 || slot > 3) abort();
    online = 1;
    local_slot = slot;
    tick = 0;
}
EMSCRIPTEN_KEEPALIVE uint32_t sled_online_tick(void) { return tick; }
EMSCRIPTEN_KEEPALIVE uint32_t sled_online_digest(void) { return last_digest; }
int sled_web_online_enabled(void) { return online; }
int sled_web_online_slot(void) { return local_slot; }
void sled_web_bind_cpu(CPUState *cpu) { bound_cpu = cpu; }

EM_JS(int, sled_web_replaying, (), { return Module.sledNetwork?.replaying ? 1 : 0; });
EM_ASYNC_JS(void, exchange_frame, (uint32_t frame, uint32_t digest, int has_digest, uint16_t *target), {
    try {
        const pads = await Module.sledNetwork.exchange(frame, has_digest ? digest : null);
        for (let i=0;i<4;i++) HEAPU16[(target>>1)+i]=pads[i];
    } catch(error) {
        Module.sledNetwork.fail(String(error));
        await new Promise(()=>{});
    }
});

void sled_web_sync_frame(void) {
    sled_web_progress_tick();
    if (!online) return;
    if (!bound_cpu) abort();
    const int check = tick % 25 == 0;
    if (check) last_digest = netplay_core_digest(bound_cpu);
    uint16_t pads[4];
    exchange_frame(tick, last_digest, check, pads);
    sled_web_apply_controller_row(pads);
    ++tick;
}

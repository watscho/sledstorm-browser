/* Read-only, title-specific camera diagnostics. This does not implement an
 * own-view mod, change projection, or claim a synchronized session. */
#include "psx_memory.h"
#include "gpu.h"
#include <emscripten/emscripten.h>
#include <stdint.h>
#include <sys/resource.h>
#include <errno.h>

EMSCRIPTEN_KEEPALIVE uint32_t sled_projection_word(int field) {
    GpuWsDebug d;
    gpu_ws_get_debug(&d);
    switch (field) {
        case 0: return d.mode;
        case 1: return d.xnum;
        case 2: return d.xden;
        case 3: return d.active;
        case 4: return d.present_native_43;
        default: return 0;
    }
}

EMSCRIPTEN_KEEPALIVE uint32_t sled_camera_word(int field) {
    static const uint32_t addresses[] = {
        0x800D6980u, /* race active: upstream widescreen mod */
        0x800D6A10u, /* human-player count: upstream widescreen mod */
        0x800C3CA0u, /* frontend mode: upstream widescreen mod */
        0x800E2E08u, /* view 0 packed bound (base + 0x158) */
        0x800E302Cu, /* view 1 bound; stride 0x224 at setup loop 0x8005BF60 */
        0x800C34E0u, /* original pause/menu latch, enter 8006D004 / resume 8006D0F8 */
    };
    uint32_t result = 0;
    if (field < 0 || field >= (int)(sizeof addresses / sizeof addresses[0])) return 0;
    psx_peek_word(addresses[field], &result);
    return result;
}

/* Browsers expose no process page-fault or disk-IO counters. Report ENOSYS,
 * matching the SDK, without printing the unsupported-syscall warning per frame.
 * This is not a performance measurement implementation. */
int sled_web_getrusage(int who, struct rusage *usage) {
    (void)who; (void)usage;
    errno = ENOSYS;
    return -1;
}

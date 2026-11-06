/* Experimental PAL-only full-view redraw. All title-specific writes and guest
 * calls run inside the runtime's restoring render transaction. Never changes
 * canonical multiplayer layout, physics or camera state. */
#include "web_network.h"
#include "mod_plugins.h"
#include "netplay_state_digest.h"
#include "gpu.h"
#include "web_hud.h"
#include <emscripten/emscripten.h>
#include <stdio.h>
#include <stdlib.h>

static int enabled;
static uint32_t attempts, committed, reason, stage;
EMSCRIPTEN_KEEPALIVE void sled_camera_enable(int on) {
    enabled = on;
    // The built-in Internal Resolution option otherwise selects Native over
    // the title baseline. Both peers use this fixed presentation profile;
    // dual-raster keeps the authoritative software simulation at 1x.
    if (on == 2 && !getenv("PSX_INTERNAL_RESOLUTION")) setenv("PSX_INTERNAL_RESOLUTION", "2x", 1);
}
int sled_web_camera_mode(void) { return enabled; }
EMSCRIPTEN_KEEPALIVE uint32_t sled_camera_status(int field) {
    return field == 0 ? attempts : field == 1 ? committed : reason;
}
static int ram_address(uint32_t a) { return (a & 0x1fffffff) >= 0x10000 && (a & 0x1fffffff) < 0x200000; }
static int draw_local(CPUState *cpu, void *user, uint32_t alpha) {
    (void)user; (void)alpha;
    // VBlank may interrupt BIOS/CD work. Establish the title's ABI rather
    // than borrowing that interrupted routine's GP and scratch PC. The GP
    // comes from the audited startup at 0x80080178: lui/addiu gp,0x800C1F18.
    cpu->gpr[28] = 0x800C1F18u;
    cpu->gpr[29] = 0x801FF000u;
    cpu->cop0[12] &= ~1u;
    const uint32_t view = 0x800E2CB0u;
    const uint32_t selected = view + (uint32_t)sled_web_online_slot() * 0x224u;
    const uint32_t camera = psx_mod_read_word(selected + 0x220u);
    const uint32_t context = psx_mod_read_word(0x800C3CB8u);
    const uint32_t rank = psx_mod_read_word(cpu->gpr[28] + 0x1ff0u);
    if (attempts == 1) printf("Camera ABI: context=%08x rank=%x camera=%08x\n", context, rank, camera);
    if (!ram_address(camera) || !ram_address(context) || rank > 0x8000u) return 0;
    for (uint32_t i = 0; i < 0x224u; i += 4)
        psx_mod_write_word(view + i, psx_mod_read_word(selected + i));
    psx_mod_write_word(0x800D6A10u, 1);
    const uint32_t ret = 0x80053E24u;
    stage = 1;
    psx_mod_call_guest(cpu, 0x8005AEA0u, ret, view, camera, 0, 0);
    if (psx_mod_read_word(view + 0x158u) != 0x01000200u) return 0;
    const uint32_t ot = context + 0x70u;
    stage = 2;
    for (uint32_t i = 0; i <= rank; ++i)
        psx_mod_write_word(ot + i * 4, i ? ((ot + (i - 1) * 4) & 0x00ffffffu) : 0x00ffffffu);
    stage = 3;
    psx_mod_call_guest(cpu, 0x80051010u, ret, 0, 0, 0, 0);
    // DrawOTag: GPU DMA completes synchronously in the frozen sandbox.
    stage = 4;
    psx_mod_call_guest(cpu, 0x800823ECu, ret, ot + rank * 4, 0, 0, 0);
    stage = 5;
    return 1;
}
void sled_web_camera_present(CPUState *cpu) {
    if (enabled == 2) { sled_web_hud_tag(); return; }
    if (enabled != 1 || !sled_web_online_enabled() || !cpu ||
        psx_mod_read_word(0x800D6980u) != 1 || psx_mod_read_word(0x800C3CA0u) != 0 ||
        psx_mod_read_word(0x800D6A10u) != 2) return;
    reason = psx_mod_render_local_view_status();
    if (reason) return;
    GpuDisplayInfo di;
    gpu_get_display_info(&di);
    if (di.disabled || di.depth24 || di.width != 512 || di.height != 256) return;
    const uint32_t before = netplay_core_digest(cpu);
    PSXModRenderPass rect = { sizeof(rect), 0, di.display_x, di.display_y, di.width, di.height };
    ++attempts;
    const int ok = psx_mod_render_local_view(cpu, &rect, draw_local, NULL);
    if (netplay_core_digest(cpu) != before) {
        fprintf(stderr, "Full-camera transaction changed canonical core; refusing to continue\n");
        abort();
    }
    if (ok) ++committed;
    else printf("Camera redraw refused at stage %u\n", stage);
    if (attempts <= 3) printf("Full-camera redraw: attempt=%u committed=%u status=%u\n", attempts, committed, reason);
}

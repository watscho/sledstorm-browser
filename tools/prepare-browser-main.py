"""Generate a browser-only main.cpp with audited, anchor-checked integration.

Original integration additions are MIT-licensed. Embedded upstream matching
text and generated derivatives retain upstream/game terms; see
THIRD_PARTY_NOTICES.md.

The downloaded native source is never edited. A missing/duplicated anchor
fails the build instead of quietly inserting a hook into a different revision.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'research/port/psxrecomp/runtime/src/main.cpp'
TARGET = ROOT / '.cache/browser-source/main_web.cpp'


def patch_once(source, anchor, replacement):
    if source.count(anchor) != 1:
        raise RuntimeError(f'Expected exactly one integration anchor: {anchor[:80]}')
    return source.replace(anchor, replacement, 1)


source = SOURCE.read_text()
source = '#include "web_network.h"\n#include "web_preferences.h"\n' + source
source = patch_once(source, '    psx_netplay_bind_cpu(&cpu);',
                    '    psx_netplay_bind_cpu(&cpu);\n    sled_web_bind_cpu(&cpu);\n    sled_web_preferences_apply();')
# Replay preserves every guest quantum, but removes host wall-clock waits.
source = patch_once(source, '    if (!psx_netplay_active() && !psx_selfcheck_resim_active()) {',
                    '    if (!psx_netplay_active() && !psx_selfcheck_resim_active() && !sled_web_replaying()) {')
source = patch_once(source, '    dynres_tick();   /* after the present: a scale step lands between frames */',
                    '    dynres_tick();   /* after the present: a scale step lands between frames */\n'
                    '    sled_web_sync_frame(); /* authoritative row for the next guest quantum */')
for function in ('sample_pad_into_sio', 'sample_headless_pad_into_sio'):
    anchor = f'static void {function}(int override) {{'
    source = patch_once(source, anchor, anchor + '\n    if (sled_web_online_enabled()) return;')
source = patch_once(source, '    if (net_cfg.enabled) {\n        s_netplay_sim_native_scale = 1;',
                    '    if (net_cfg.enabled || sled_web_online_enabled()) {\n        s_netplay_sim_native_scale = 1;')
source = patch_once(source,
                    '    if (g_netplay_local_viewport != 1 ||\n        !psx_netplay_active() ||',
                    '    if (g_netplay_local_viewport != 1 ||\n        !(psx_netplay_active() || sled_web_online_enabled()) ||')
source = patch_once(source,
                    '    if (g_netplay_local_viewport != 1 || !psx_netplay_active())',
                    '    if (g_netplay_local_viewport != 1 || !(psx_netplay_active() || sled_web_online_enabled()))')
source = patch_once(source, '    int slot = psx_netplay_local_port();',
                    '    int slot = sled_web_online_enabled() ? sled_web_online_slot() : psx_netplay_local_port();')
source = patch_once(source,
                    '    if (!netplay_enabled ||\n        g_netplay_local_viewport != 1 ||',
                    '    if (!(netplay_enabled || sled_web_online_enabled()) ||\n        g_netplay_local_viewport != 1 ||')
source = patch_once(source, '    gpu_ws_set_netplay_local_viewport(1, psx_netplay_local_port());',
                    '    gpu_ws_set_netplay_local_viewport(1, sled_web_online_enabled() ? sled_web_online_slot() : psx_netplay_local_port());')
source = patch_once(source, '    if (net_cfg.enabled && s_netplay_gl_present && gl_renderer_cpu_auth_dual()) {',
                    '    if ((net_cfg.enabled || sled_web_online_enabled()) && s_netplay_gl_present && gl_renderer_cpu_auth_dual()) {')
source = patch_once(source, '                            (net_cfg.enabled && s_netplay_gl_present &&',
                    '                            ((net_cfg.enabled || sled_web_online_enabled()) && s_netplay_gl_present &&')
# The redraw transaction runs before the host presents the completed frame.
source = patch_once(source, '    bool local_viewport_crop_applied = false;',
                    '    sled_web_camera_present(debug_cpu_ptr);\n    bool local_viewport_crop_applied = false;')
TARGET.parent.mkdir(parents=True, exist_ok=True)
if not TARGET.exists() or TARGET.read_text() != source:
    TARGET.write_text(source)
print('Prepared browser-only tick/input integration')

render = (SOURCE.parent / 'render_pass.c').read_text()
render = '#include "web_network.h"\n' + render
render = patch_once(render, 'kind == 2 ? !psx_netplay_active()',
                    'kind == 2 ? !(psx_netplay_active() || sled_web_online_enabled())')
render_target = TARGET.parent / 'render_pass_web.c'
if not render_target.exists() or render_target.read_text() != render:
    render_target.write_text(render)

gpu = (SOURCE.parent / 'gpu.c').read_text()
gpu = '#include "web_hud.h"\n' + gpu
# GP0(1Fh) is a real one-word IRQ1 request, acknowledged by GP1(02h).
# https://psx-spx.consoledev.net/graphicsprocessingunitgpu/#gp01fh-interrupt-request-irq1
gpu = patch_once(gpu, '        /* Drawing commands — polygons */\n        case 0x20: case 0x21: case 0x22: case 0x23:\n            gp0_exec_mono_tri();',
                 '        case 0x1F:\n'
                 '            irq1_flag = 1;\n'
                 '            psx_irq_raise(1, 0); /* IRQ_GPU */\n'
                 '            break;\n\n'
                 '        /* Drawing commands — polygons */\n        case 0x20: case 0x21: case 0x22: case 0x23:\n            gp0_exec_mono_tri();')

gpu = patch_once(gpu, 'static int ws_local_viewport_state_ok(void) {',
                 'static int ws_local_viewport_state_ok(void) {\n    if (!sled_web_two_player_view() || sled_web_menu_active()) return 0;')
gpu = patch_once(gpu, 'static int ws_shared_ui_packet(void) {',
                'static int ws_shared_ui_packet(void) {\n'
                '    if (sled_web_hud_owned(gp0_cmd_source_addr - 4u)) return 0;')
# Apply the title HUD transform after all generic widescreen heuristics,
# directly from guarded original packet coordinates. World quads return 0.
anchor = """    for (int i = 0; i < 4; i++) {
        vx[i] += draw_offset_x;
        vy[i] += draw_offset_y;
    }
    if (draw_area_out_bbox(vx, vy, 4)) return;

    setup_textured_draw(color24, semi_trans, raw_texture);"""
gpu = patch_once(gpu, 'static int native_wide_projective_draw(void) {',
                'static int native_wide_projective_draw(void) {\n    if (sled_web_hud_owned(gp0_cmd_source_addr - 4u)) return 0;')
gpu = patch_once(gpu, anchor,
                '    sled_web_hud_transform(gp0_cmd_source_addr - 4u, ws_shared_ui_copy, vx, vy);\n' + anchor)
gpu_target = TARGET.parent / 'gpu_web.c'
if not gpu_target.exists() or gpu_target.read_text() != gpu:
    gpu_target.write_text(gpu)

# Browser-only replacement at the two-player race HUD entry. Generated native
# code and the original emulator remain unchanged.
hud_source = ROOT / 'research/port/generated/SLES_021.94_full_30.c'
hud = '#include "web_hud.h"\n' + hud_source.read_text()
hud = patch_once(hud, 'void func_80064128(CPUState* cpu)\n{',
                 'void func_80064128(CPUState* cpu)\n{\n'
                 '    if (sled_web_single_hud(cpu)) { cpu->pc = cpu->gpr[31]; return; }')
hud_target = TARGET.parent / 'game_hud_web.c'
if not hud_target.exists() or hud_target.read_text() != hud:
    hud_target.write_text(hud)


# The framework enables real SCPH-1070 only at five logical slots: A-D and
# the opposite physical port. Main/game still have four player slots; only
# SIO needs the fifth (disconnected) slot. This avoids changing game structs.
sio = '#undef PSX_MAX_PLAYERS\n#define PSX_MAX_PLAYERS 5\n' + (SOURCE.parent / 'sio.c').read_text()
sio_target = TARGET.parent / 'sio_web.c'
if not sio_target.exists() or sio_target.read_text() != sio:
    sio_target.write_text(sio)

# 8005F344 selects load8/load9 through the table at 800A5088 and calls the
# resource loader at 8005F498. Select the HUD atlas before that lookup, rather
# than relying on which VBlank happens to run during asynchronous CD loading.
assets = (ROOT / 'research/port/generated/SLES_021.94_full_28.c').read_text()
assets = '#include "web_hud.h"\n' + assets
assets = patch_once(assets, 'void func_8005F344(CPUState* cpu)\n{',
                    'void func_8005F344(CPUState* cpu)\n{\n    sled_web_hud_tag();')
assets_target = TARGET.parent / 'game_assets_web.c'
if not assets_target.exists() or assets_target.read_text() != assets:
    assets_target.write_text(assets)

#!/usr/bin/env python3
"""Patch pinned, ignored emulator sources with a true retro_run frame boundary."""
from pathlib import Path
import subprocess
import shutil

ROOT = Path(__file__).resolve().parent.parent
CORE = ROOT / '.cache/pcsx-sources'
FRONTEND = ROOT / '.cache/emulator-retroarch'


def once(text, before, after):
    if after in text:
        return text
    if text.count(before) != 1:
        raise RuntimeError('Pinned source anchor changed: ' + before[:60])
    return text.replace(before, after)


def original(path):
    """Regenerate our ignored patches from the verified immutable source."""
    directory = CORE if path.is_relative_to(CORE) else FRONTEND
    return subprocess.check_output(['git', 'show', 'HEAD:' + str(path.relative_to(directory))],
                                   cwd=directory, text=True)


def main():
    for directory, commit in [(CORE, 'f29871dde1742cafb0ab56ba33636a8600bbbd80'),
                              (FRONTEND, '6dd4353937ef48b6ec0bfbdbb15d1c5992d86927')]:
        actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=directory, text=True).strip()
        if actual != commit:
            raise RuntimeError(f'{directory}: expected pinned source {commit}')
    path = CORE / 'frontend/libretro.c'
    text = original(path)
    text = text.replace('unsigned sled_frame_count(void) { return frame_counter; }',
                        'static unsigned sled_completed_frames;\nunsigned sled_frame_count(void) { return sled_completed_frames; }')
    old_after = '   EM_ASM({ if (Module.sledCoreAfter) Module.sledCoreAfter(); });'
    if old_after in text and '++sled_completed_frames;' not in text:
        text = text.replace(old_after, '   ++sled_completed_frames;\n' + old_after)
    text = once(text, 'void retro_run(void)\n{', '''
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
static unsigned sled_completed_frames;
unsigned sled_frame_count(void) { return sled_completed_frames; }
unsigned sled_ram_pointer(void) { return (unsigned)(uintptr_t)psxM; }
#endif

void retro_run(void)
{
#ifdef __EMSCRIPTEN__
   if (!EM_ASM_INT({ return Module.sledCoreBefore ? (Module.sledCoreBefore() ? 1 : 0) : 1; })) return;
#endif''')
    text = once(text, '   vout_fb_dirty = 0;\n\n#ifdef HAVE_CDROM', '''   vout_fb_dirty = 0;
#ifdef __EMSCRIPTEN__
   ++sled_completed_frames;
   EM_ASM({ if (Module.sledCoreAfter) Module.sledCoreAfter(); });
#endif

#ifdef HAVE_CDROM''')
    text = once(text, '#ifdef GPU_NEON\n#define VOUT_MAX_WIDTH  1024',
                '#ifdef __EMSCRIPTEN__\n#define VOUT_MAX_WIDTH  2048\n#elif defined(GPU_NEON)\n#define VOUT_MAX_WIDTH  1024')
    text = once(text, 'static enum retro_pixel_format current_fmt;', '''static enum retro_pixel_format current_fmt;
#ifdef __EMSCRIPTEN__
#include "sled-view.h"
static bool sled_wide_geometry;
#endif''')
    text = once(text, '   info->geometry.aspect_ratio   = 4.0 / 3.0;', '''   info->geometry.aspect_ratio   = 4.0 / 3.0;
#ifdef __EMSCRIPTEN__
   info->geometry.max_height = 2 * VOUT_MAX_HEIGHT;
   if (sled_wide_geometry) {
      info->geometry.base_width   = SLED_WIDE_WIDTH;
      info->geometry.base_height  = 256;
      info->geometry.aspect_ratio = 16.0 / 9.0;
   }
#endif''')
    text = once(text, '   psxRegs.stop = 0;\n   psxCpu->Execute(&psxRegs);',
                '   sled_view_begin();\n   psxRegs.stop = 0;\n   psxCpu->Execute(&psxRegs);\n   sled_view_present();')
    text = once(text, '   video_cb((vout_fb_dirty || !vout_can_dupe) ? vout_buf_ptr : NULL,', '''#ifdef __EMSCRIPTEN__
   const uint16_t *wide = sled_view_wide_frame();
   const uint16_t *wide_enhanced = sled_view_wide_enhanced_frame();
   const uint16_t *enhanced = sled_view_enhanced_frame();
   const bool enhance = EM_ASM_INT({ return !!Module.sledEnhancedGraphics; });
   static unsigned char *enhanced_output;
   static int wide_scale = 1;
   if ((wide || enhanced) && !enhanced_output)
      enhanced_output = malloc(SLED_WIDE_2X_WIDTH * 512 * 4);
   if (wide)
      wide_scale = wide_enhanced ? 2 : 1;
   const bool wide_geometry = enhanced_output &&
      (wide || (sled_wide_geometry && sled_view_wide_pending()));
   if (wide_geometry != sled_wide_geometry) {
      struct retro_system_av_info info;
      sled_wide_geometry = wide_geometry;
      retro_get_system_av_info(&info);
      environ_cb(RETRO_ENVIRONMENT_SET_GEOMETRY, &info.geometry);
   }
   if (wide_geometry || (enhanced && enhanced_output)) {
      const int width = wide_geometry ? SLED_WIDE_WIDTH * wide_scale : 1024;
      const int height = wide_geometry ? 256 * wide_scale : 512;
      const uint16_t *source = wide_geometry ? (wide_scale == 2 ? wide_enhanced : wide) : enhanced;
      const int stride = wide_enhanced ? SLED_WIDE_2X_WIDTH : 1024;
      const int xrgb = current_fmt == RETRO_PIXEL_FORMAT_XRGB8888;
      const int pitch = width * (xrgb ? 4 : 2);
      bgr_to_fb_func *convert = xrgb ? bgr555_to_xrgb8888 : bgr555_to_rgb565;
      if (source)
         for (int row = 0; row < height; row++)
            convert(enhanced_output + row * pitch, source + row * stride, width * 2);
      const void *scaled = enhance && wide_geometry && wide_scale == 1
         ? sled_scale_frame_2x(enhanced_output, width, height, pitch, xrgb ? 4 : 2) : NULL;
      if (scaled)
         video_cb(scaled, 2 * width, 2 * height, 2 * pitch);
      else
         video_cb(enhanced_output, width, height, pitch);
   } else if (enhance && vout_width <= 1024 && vout_height <= 512) {
      const int bytes_pp = current_fmt == RETRO_PIXEL_FORMAT_XRGB8888 ? 4 : 2;
      const int pitch = 2 * vout_width * bytes_pp;
      if (!vout_fb_dirty && vout_can_dupe)
         video_cb(NULL, 2 * vout_width, 2 * vout_height, pitch);
      else {
         const void *scaled = sled_scale_frame_2x(vout_buf_ptr, vout_width, vout_height, vout_pitch_b, bytes_pp);
         if (scaled)
            video_cb(scaled, 2 * vout_width, 2 * vout_height, pitch);
         else
            video_cb(vout_buf_ptr, vout_width, vout_height, vout_pitch_b);
      }
   } else
#endif
   video_cb((vout_fb_dirty || !vout_can_dupe) ? vout_buf_ptr : NULL,''')
    text = once(text, '/* cheats */', """
#ifdef __EMSCRIPTEN__
extern int sled_loading_checkpoint;

bool sled_unserialize_checkpoint(const void *data, size_t size)
{
   sled_loading_checkpoint = 1;
   bool ok = retro_unserialize(data, size);
   sled_loading_checkpoint = 0;
   return ok;
}
#endif

/* cheats */""")
    if path.read_text() != text:
        path.write_text(text)
    path = CORE / 'libpcsxcore/psxinterpreter.c'
    text = original(path)
    text = once(text, 'static inline void execI_(u8 **memRLUT, psxRegisters *regs) {',
                '#include "../frontend/sled-view.h"\n\nstatic inline void execI_(u8 **memRLUT, psxRegisters *regs) {')
    text = once(text, 'static inline void execI_(u8 **memRLUT, psxRegisters *regs) {\n\tu32 pc = regs->pc;',
                '''static inline void execI_(u8 **memRLUT, psxRegisters *regs) {
	u32 pc = regs->pc;
	if ((pc == 0x80014e88u || pc == 0x80014e90u || pc == 0x80014e98u ||
	     pc == 0x80053e68u || pc == 0x8004a41cu || pc == 0x8004c700u ||
	     pc == 0x8004ac84u || pc == 0x80051e38u || pc == 0x80051af0u ||
	     pc == 0x8005f344u || pc == 0x80064128u || pc == 0x800650fcu ||
	     pc == 0x80051680u || pc == 0x80060decu || pc == 0x8006126cu ||
	     pc == 0x8007ec9cu || pc == 0x8007f2c0u || pc == 0x8007f8c4u ||
	     pc == 0x8007fe7cu) &&
	    sled_view_pc(regs))
		return;''')
    text = once(text, '} ICache[256];', '''} ICache[256];
static struct cache_entry sled_saved_icache[256];
void sled_view_cache_save(int restore) {
    if (restore) memcpy(ICache, sled_saved_icache, sizeof(ICache));
    else memcpy(sled_saved_icache, ICache, sizeof(ICache));
}''')
    if path.read_text() != text:
        path.write_text(text)
    path = CORE / 'libpcsxcore/r3000a.c'
    text = original(path)
    text = once(text, 'void psxBranchTest() {',
                '#include "../frontend/sled-view.h"\n\nvoid psxBranchTest() {\n\tif (sled_view_transaction) return;')
    if path.read_text() != text:
        path.write_text(text)
    path = CORE / 'libpcsxcore/psxhw.c'
    text = original(path)
    text = once(text, 'u8 psxHwRead8(u32 add) {',
                '#include "../frontend/sled-view.h"\n\nu8 psxHwRead8(u32 add) {')
    for bits in (8, 16, 32):
        read = f'u{bits} psxHwRead{bits}(u32 add) {{'
        write = f'void psxHwWrite{bits}(u32 add, u32 value) {{'
        text = once(text, read, read + '\n\tif (sled_view_transaction == 2) { sled_view_hardware_access = 1; return 0; }')
        text = once(text, write, write + '\n\tif (sled_view_transaction == 2) { sled_view_hardware_access = 1; return; }')
    if path.read_text() != text:
        path.write_text(text)
    for name in ('sled-view.c', 'sled-view.h', 'sled-enhanced.c'):
        source, target = ROOT / 'research/emulator' / name, CORE / 'frontend' / name
        if not target.exists() or source.read_bytes() != target.read_bytes():
            shutil.copyfile(source, target)
    path = CORE / 'Makefile'
    text = original(path)
    text = once(text, "sed -e 's/.*/#define REV \"\\0\"/'", "sed -e 's/.*/#define REV \"&\"/'")
    text = once(text, '$(TARGET): $(OBJS)', '''OBJS += frontend/sled-view.o
ifeq ($(platform),emscripten)
OBJS += frontend/sled-enhanced.o plugins/gpu_neon/psx_gpu/psx_gpu_simd.o
frontend/sled-enhanced.o: CFLAGS += -mssse3 -DNEON_BUILD -DSIMD_BUILD -DTEXTURE_CACHE_4BPP -DTEXTURE_CACHE_8BPP
frontend/sled-enhanced.o: plugins/gpu_neon/psx_gpu_if.c $(wildcard plugins/gpu_neon/psx_gpu/*.c)
plugins/gpu_neon/psx_gpu/psx_gpu_simd.o: CFLAGS += -mssse3 -DSIMD_BUILD
endif

$(TARGET): $(OBJS)''')
    if path.read_text() != text:
        path.write_text(text)
    path = CORE / 'plugins/gpu_neon/psx_gpu/psx_gpu_simd.c'
    text = once(original(path), '#include <x86intrin.h>', '''#ifdef __EMSCRIPTEN__
#include <tmmintrin.h>
#else
#include <x86intrin.h>
#endif''')
    if path.read_text() != text:
        path.write_text(text)
    path = CORE / 'plugins/dfxvideo/gpulib_if.c'
    text = original(path)
    text = once(text, '#include "soft.c"', '''/* The widened private framebuffer can overlap texture pages in PSX VRAM. */
static const unsigned short *sled_texture_words;
static const unsigned char *sled_texture_bytes;
static unsigned sled_wide_draw;
void sled_renderer_set_widescreen(const void *texture_vram)
{
  sled_texture_words = texture_vram ? texture_vram : psxVuw;
  sled_texture_bytes = texture_vram ? texture_vram : psxVub;
  sled_wide_draw = texture_vram != NULL;
}
#define SLED_TEXTURE_WORDS sled_texture_words
#define SLED_TEXTURE_BYTES sled_texture_bytes
#ifdef __EMSCRIPTEN__
#define SLED_WIDE_DRAW_END(x) (sled_wide_draw && (x) == 511 ? SLED_WIDE_WIDTH - 1 : (x))
#define SLED_WIDE_DRAW_OFFSET(x) (sled_wide_draw && (x) == 0 ? SLED_WIDE_MARGIN : (x))
#endif
#include "soft.c"''')
    text = once(text, ' psxVuw=(unsigned short *)psxVub;',
                ' psxVuw=(unsigned short *)psxVub;\n sled_renderer_set_widescreen(NULL);')
    text = once(text, '#include "../gpulib/gpu.h"', '#include "../gpulib/gpu.h"\n#include "../../frontend/sled-view.h"')
    text = once(text, 'int renderer_init(void)', 'void sled_renderer_set_vram(void *vram) { set_vram(vram); }\n\nint renderer_init(void)')
    entry = 'int do_cmd_list(uint32_t *list, int list_len,\n int *cycles_sum_out, int *cycles_last, int *last_cmd)\n{'
    text = once(text, entry, entry + '''
#ifdef __EMSCRIPTEN__
  if (sled_view_transaction == 2)
    sled_enhanced_draw(list, list_len, gpu.ex_regs);
#endif''')
    text = once(text, '    primTableJ[cmd]((void *)list);',
                '    sled_view_record(list, 1 + len);\n    primTableJ[cmd]((void *)list);')
    if path.read_text() != text:
        path.write_text(text)
    path = CORE / 'plugins/dfxvideo/prim.c'
    text = once(original(path), ' drawW  = gdata & 0x3ff;', '''#ifdef SLED_WIDE_DRAW_END
 drawW  = SLED_WIDE_DRAW_END(gdata & 0x3ff);
#else
 drawW  = gdata & 0x3ff;
#endif''')
    text = once(text, ' PSXDisplay.DrawOffset.x = (short)(gdata & 0x7ff);', '''#ifdef SLED_WIDE_DRAW_OFFSET
 PSXDisplay.DrawOffset.x = (short)SLED_WIDE_DRAW_OFFSET(gdata & 0x7ff);
#else
 PSXDisplay.DrawOffset.x = (short)(gdata & 0x7ff);
#endif''')
    if path.read_text() != text:
        path.write_text(text)
    path = CORE / 'plugins/dfxvideo/soft.c'
    text = original(path)
    text = once(text, '// switches for painting textured quads', '''#ifndef SLED_TEXTURE_WORDS
#define SLED_TEXTURE_WORDS psxVuw
#define SLED_TEXTURE_BYTES psxVub
#endif

// switches for painting textured quads''')
    # Only texture and CLUT reads use the separate pointer. Framebuffer
    # writes and blend destination reads stay on the original pointer.
    for before, after in (
        ('psxVub[', 'SLED_TEXTURE_BYTES['),
        ('GETLE16(&psxVuw[', 'GETLE16(&SLED_TEXTURE_WORDS['),
        ('psxVuw[clutP+tC]);', 'SLED_TEXTURE_WORDS[clutP+tC]);'),
        ('unsigned char * pV;', 'const unsigned char *pV;'),
    ):
        if before not in text:
            raise RuntimeError('Pinned Peops texture read changed: ' + before)
        text = text.replace(before, after)
    if path.read_text() != text:
        path.write_text(text)
    # Ordinary savestates retain upstream compatibility fixups. A network
    # checkpoint comes from this same core and must retain the saved timing.
    path = CORE / 'libpcsxcore/misc.c'
    text = original(path)
    text = once(text, 'static u32 save_counter;', 'static u32 save_counter;\nint sled_loading_checkpoint;')
    text = once(text, '\tgpuSyncPluginSR();', '\tif (!sled_loading_checkpoint)\n\t\tgpuSyncPluginSR();')
    text = once(text, '\tevents_restore();\n\tif (Config.HLE)',
                '\tif (!sled_loading_checkpoint)\n\t\tevents_restore();\n\tif (Config.HLE && !sled_loading_checkpoint)')
    if path.read_text() != text:
        path.write_text(text)
    path = CORE / 'libpcsxcore/psxcounters.c'
    text = original(path)
    text = once(text, 's32 psxRcntFreeze( void *f, s32 Mode )',
                'extern int sled_loading_checkpoint;\n\ns32 psxRcntFreeze( void *f, s32 Mode )')
    text = once(text, '    if (Mode == 0)\n    {\n        rcnts[3].rate = 1;',
                '    if (Mode == 0 && !sled_loading_checkpoint)\n    {\n        rcnts[3].rate = 1;')
    if path.read_text() != text:
        path.write_text(text)
    path = CORE / 'libpcsxcore/cdrom.c'
    text = original(path)
    text = once(text, 'int cdrFreeze(void *f, int Mode) {',
                'extern int sled_loading_checkpoint;\n\nint cdrFreeze(void *f, int Mode) {')
    text = once(text, '\t\tcdr.FifoSize = (cdr.Mode & MODE_SIZE_2340) ? 2340 : 2048 + 12;',
                '\t\tif (!sled_loading_checkpoint)\n\t\t\tcdr.FifoSize = (cdr.Mode & MODE_SIZE_2340) ? 2340 : 2048 + 12;')
    if path.read_text() != text:
        path.write_text(text)
    path = CORE / 'plugins/gpulib/gpu.c'
    text = original(path)
    text = once(text, 'long GPUfreeze(uint32_t type, GPUFreeze_t *freeze)',
                'extern int sled_loading_checkpoint;\n\nlong GPUfreeze(uint32_t type, GPUFreeze_t *freeze)')
    text = once(text, '        GPUwriteStatus((i << 24) | freeze->ulControl[i]);',
                """        GPUwriteStatus((i << 24) | freeze->ulControl[i]);
      if (sled_loading_checkpoint) {
        memcpy(gpu.regs, freeze->ulControl, sizeof(gpu.regs));
        gpu.status = freeze->ulStatus;
      }""")
    if path.read_text() != text:
        path.write_text(text)
    path = FRONTEND / 'network/netplay/netplay_private.h'
    text = once(original(path), '   bool force_rewind;', '''   bool force_rewind;
   bool sled_received_state;
#ifdef __EMSCRIPTEN__
   bool sled_targeted_savestate;
#endif''')
    text = once(text, '   retro_time_t ping_timer;', '''   retro_time_t ping_timer;
#ifdef __EMSCRIPTEN__
   retro_time_t sled_last_input_at;
   retro_time_t sled_sync_grace_until;
   bool sled_needs_savestate;
#endif''')
    if path.read_text() != text:
        path.write_text(text)
    path = FRONTEND / 'network/netplay/netplay_frontend.c'
    text = once(original(path), 'static net_driver_state_t networking_driver_st = {0};', """#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#endif

static net_driver_state_t networking_driver_st = {0};
#ifdef __EMSCRIPTEN__
unsigned sled_netplay_status(unsigned field)
{
   netplay_t *netplay = networking_driver_st.data;
   if (!netplay)
      return 0;
   if (field == 1)
      return (unsigned)__builtin_popcount(netplay->connected_players);
   if (field == 2)
      return netplay->run_frame_count;
   if (field == 3)
      return netplay->is_replay;
   if (field == 4)
      return netplay->stall == NETPLAY_STALL_RUNNING_FAST || netplay->remote_paused;
   if (field == 5)
      return !netplay->is_server && netplay->self_mode == NETPLAY_CONNECTION_SLAVE &&
         netplay->sled_received_state && netplay->server_frame_count > netplay->run_frame_count
         ? netplay->server_frame_count - netplay->run_frame_count : 0;
   if ((netplay->self_mode != NETPLAY_CONNECTION_PLAYING &&
        netplay->self_mode != NETPLAY_CONNECTION_SLAVE) ||
       (!netplay->is_server && (!netplay->sled_received_state || netplay->force_rewind)))
      return 0;
   return netplay->self_devices;
}
#endif""")
    text = once(text, '                  connection->mode = NETPLAY_CONNECTION_SLAVE;', '''                  connection->mode = NETPLAY_CONNECTION_SLAVE;
#ifdef __EMSCRIPTEN__
                  connection->sled_last_input_at = cpu_features_get_time_usec();
                  connection->sled_sync_grace_until = connection->sled_last_input_at + 5000000;
#endif''')
    text = once(text, '            /* Slaves may go through several packets of data in the same frame', '''#ifdef __EMSCRIPTEN__
            if (connection->mode == NETPLAY_CONNECTION_SLAVE)
               connection->sled_last_input_at = cpu_features_get_time_usec();
#endif

            /* Slaves may go through several packets of data in the same frame''')
    text = once(text, 'static void netplay_handle_slaves(netplay_t *netplay)\n{\n   struct delta_frame *frame = &netplay->buffer[netplay->self_ptr];\n   size_t i;', '''static void netplay_handle_slaves(netplay_t *netplay)
{
   struct delta_frame *frame = &netplay->buffer[netplay->self_ptr];
   size_t i;
#ifdef __EMSCRIPTEN__
   const bool dedicated = EM_ASM_INT({ return !!Module.sledDedicatedHost; });
   const retro_time_t now = dedicated ? cpu_features_get_time_usec() : 0;
#endif''')
    text = once(text, '         /* This is a slave connection. First, should we do anything at all? If', '''#ifdef __EMSCRIPTEN__
         /* Keep the authoritative clock independent of browser scheduling.
          * Retain input across ordinary jitter, then release held buttons.
          * Give a background tab time to resume before closing its connection. */
         const retro_time_t age = dedicated ? now - connection->sled_last_input_at : 0;
         if (dedicated && age >= 8000000 && now >= connection->sled_sync_grace_until)
         {
            netplay_hangup(netplay, connection);
            continue;
         }
#endif

         /* This is a slave connection. First, should we do anything at all? If''')
    text = once(text, '               /* Start with blank input */\n               if (!istate_in)', '''               /* Start with blank input, or release a stale browser pad. */
               if (!istate_in
#ifdef __EMSCRIPTEN__
                     || (dedicated && age >= 150000)
#endif
                  )''')
    text = once(text, '''   /* Resolve and/or simulate the input if we don't have real input. */
   netplay_resolve_input(netplay, netplay->run_ptr, false);

   /* Handle slaves. */
   if (netplay->is_server && netplay->connected_slaves)
      netplay_handle_slaves(netplay);
''', '''   bool dedicated = false;
#ifdef __EMSCRIPTEN__
   dedicated = netplay->is_server && EM_ASM_INT({ return !!Module.sledDedicatedHost; });
#endif
   if (!dedicated)
      netplay_resolve_input(netplay, netplay->run_ptr, false);

   if (netplay->is_server && netplay->connected_slaves)
      netplay_handle_slaves(netplay);

   /* Resolve against the exact inputs committed and sent by this server. */
   if (dedicated)
      netplay_resolve_input(netplay, netplay->run_ptr, false);
''')
    text = once(text, '''      /* Send them the savestate */
      netplay->force_send_savestate = true;''', '''      /* Send them the savestate */
#ifdef __EMSCRIPTEN__
      connection->sled_needs_savestate = true;
#endif
      netplay->force_send_savestate = true;''')
    text = once(text, '''         /* Delay until next frame so we don't send the savestate after the
          * input */
         netplay->force_send_savestate = true;''', '''         /* Delay until next frame so we don't send the savestate after the
          * input */
#ifdef __EMSCRIPTEN__
         connection->sled_needs_savestate = true;
#endif
         netplay->force_send_savestate = true;''')
    text = once(text, '''               /* Send this along to the other side. */
               netplay_load_savestate(netplay, &serial_info, false);''', '''               /* Dedicated peers follow the server frame stream. Loading
                * a new peer must not reload the game for existing peers. */
#ifdef __EMSCRIPTEN__
               netplay->sled_targeted_savestate = EM_ASM_INT({ return !!Module.sledDedicatedHost; });
#endif
               netplay_load_savestate(netplay, &serial_info, false);
#ifdef __EMSCRIPTEN__
               netplay->sled_targeted_savestate = false;
#endif''')
    text = once(text, '''      /* Catastrophe! */
      for (i = 0; i < netplay->connections_size; i++)
         netplay_hangup(netplay, &netplay->connections[i]);''', '''      /* Catastrophe! */
      for (i = 0; i < netplay->connections_size; i++)
      {
#ifdef __EMSCRIPTEN__
         if (netplay->sled_targeted_savestate && !netplay->connections[i].sled_needs_savestate)
            continue;
#endif
         netplay_hangup(netplay, &netplay->connections[i]);
      }''')
    text = once(text, '''            ||  (connection->compression_supported != cx))
            continue;

         if (  !netplay_send''', '''            ||  (connection->compression_supported != cx))
            continue;
#ifdef __EMSCRIPTEN__
         if (netplay->sled_targeted_savestate && !connection->sled_needs_savestate)
            continue;
#endif

         if (  !netplay_send''')
    text = once(text, '''                 connection->fd, netplay->zbuffer, wn))
            netplay_hangup(netplay, connection);''', '''                 connection->fd, netplay->zbuffer, wn))
            netplay_hangup(netplay, connection);
#ifdef __EMSCRIPTEN__
         else
         {
            connection->sled_needs_savestate = false;
            if (connection->mode == NETPLAY_CONNECTION_SLAVE)
               /* Keep slow clients connected while applying the snapshot.
                * Stale buttons are still released. */
               connection->sled_sync_grace_until = cpu_features_get_time_usec() + 5000000;
         }
#endif''')
    text = once(text, '            /* Force a rewind to the relevant frame. */',
                '            netplay->sled_received_state = true;\n            /* Force a rewind to the relevant frame. */')
    text = once(text, '      if (!netplay->remote_paused)\n      {\n         retro_time_t delta',
                '''#ifdef __EMSCRIPTEN__
      /* The browser may suspend a live peer's frame loop. The WebSocket
       * transport detects a dead peer independently of frame delivery. */
      if (EM_ASM_INT({ return Module.sledNetplayActive && !Module.sledDedicatedHost; }) &&
          (netplay->is_server || netplay->sled_received_state))
         netplay->stall_time = now;
      else
#endif
      if (!netplay->remote_paused)
      {
         retro_time_t delta''')
    if path.read_text() != text:
        path.write_text(text)
    path = FRONTEND / 'frontend/drivers/platform_emulatorjs.c'
    text = once(original(path),
                '   return (emscripten_platform_data->gl_context_lost || (emscripten_platform_data->window_hidden && emscripten_platform_data->raf_interval));',
                '''   return emscripten_platform_data->gl_context_lost ||
      (emscripten_platform_data->window_hidden && emscripten_platform_data->raf_interval &&
       !EM_ASM_INT({ return !!Module.sledNetplayActive; }));''')
    if path.read_text() != text:
        path.write_text(text)
    path = FRONTEND / 'libretro-common/net/net_socket.c'
    text = original(path)
    # Browser WebSocket callbacks cannot run while WASM spins in a blocking
    # POSIX shim. Fail the affected socket operation on backpressure.
    for name in ('socket_receive_all_blocking', 'socket_send_all_blocking'):
        start = text.index('bool ' + name + '(')
        end = text.index('\nbool ' + name + '_with_timeout(', start)
        function = text[start:end]
        function = once(function, '         if (!isagain((int)ret))',
                        '#if defined(__EMSCRIPTEN__)\n         return false;\n#endif\n         if (!isagain((int)ret))')
        if name == 'socket_send_all_blocking':
            function = once(function, '      if (!ret)\n         continue;',
                            '#if defined(__EMSCRIPTEN__)\n      if (!ret)\n         return false;\n#else\n      if (!ret)\n         continue;\n#endif')
        text = text[:start] + function + text[end:]
    if path.read_text() != text:
        path.write_text(text)
    path = FRONTEND / 'Makefile.emulatorjs'
    text = original(path)
    if '_sled_frame_count,' not in text:
        text = once(text, 'EXPORTED_FUNCTIONS = _main,_malloc,_free,_load_state,',
                    'EXPORTED_FUNCTIONS = _sled_frame_count,_sled_ram_pointer,_retro_unserialize,_main,_malloc,_free,_load_state,')
    text = once(text, 'EXPORTED_FUNCTIONS = _sled_frame_count,',
                'EXPORTED_FUNCTIONS = _sled_netplay_status,_sled_unserialize_checkpoint,_sled_view_configure,_sled_view_status,_sled_frame_count,')
    if path.read_text() != text:
        path.write_text(text)
    print('Prepared pinned emulator source hooks.')


if __name__ == '__main__':
    main()

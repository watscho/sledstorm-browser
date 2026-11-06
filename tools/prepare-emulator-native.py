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
    text = once(text, '#include <emscripten.h>', '#include <emscripten.h>\n#include "sled-view.h"')
    text = once(text, '   psxRegs.stop = 0;\n   psxCpu->Execute(&psxRegs);',
                '   sled_view_begin();\n   psxRegs.stop = 0;\n   psxCpu->Execute(&psxRegs);\n   sled_view_present();')
    if path.read_text() != text:
        path.write_text(text)
    path = CORE / 'libpcsxcore/psxinterpreter.c'
    text = original(path)
    text = once(text, 'static inline void execI_(u8 **memRLUT, psxRegisters *regs) {',
                '#include "../frontend/sled-view.h"\n\nstatic inline void execI_(u8 **memRLUT, psxRegisters *regs) {')
    text = once(text, 'static inline void execI_(u8 **memRLUT, psxRegisters *regs) {\n\tu32 pc = regs->pc;',
                'static inline void execI_(u8 **memRLUT, psxRegisters *regs) {\n\tu32 pc = regs->pc;\n\tif ((pc == 0x8005f344u || pc == 0x80064128u || pc == 0x800650fcu) && sled_view_pc(regs)) return;')
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
    for name in ('sled-view.c', 'sled-view.h'):
        source, target = ROOT / 'research/emulator' / name, CORE / 'frontend' / name
        if not target.exists() or source.read_bytes() != target.read_bytes():
            shutil.copyfile(source, target)
    path = CORE / 'Makefile'
    text = original(path)
    text = once(text, "sed -e 's/.*/#define REV \"\\0\"/'", "sed -e 's/.*/#define REV \"&\"/'")
    text = once(text, '$(TARGET): $(OBJS)', 'OBJS += frontend/sled-view.o\n\n$(TARGET): $(OBJS)')
    if path.read_text() != text:
        path.write_text(text)
    path = CORE / 'plugins/dfxvideo/gpulib_if.c'
    text = original(path)
    text = once(text, 'static void set_vram(void *vram)', '#include "../../frontend/sled-view.h"\n\nstatic void set_vram(void *vram)')
    text = once(text, 'int renderer_init(void)', 'void sled_renderer_set_vram(void *vram) { set_vram(vram); }\n\nint renderer_init(void)')
    text = once(text, '    primTableJ[cmd]((void *)list);',
                '    sled_view_record(list, 1 + len);\n    primTableJ[cmd]((void *)list);')
    if path.read_text() != text:
        path.write_text(text)
    path = FRONTEND / 'Makefile.emulatorjs'
    text = original(path)
    if '_sled_frame_count,' not in text:
        text = once(text, 'EXPORTED_FUNCTIONS = _main,_malloc,_free,_load_state,',
                    'EXPORTED_FUNCTIONS = _sled_frame_count,_sled_ram_pointer,_retro_unserialize,_main,_malloc,_free,_load_state,')
    text = once(text, 'EXPORTED_FUNCTIONS = _sled_frame_count,',
                'EXPORTED_FUNCTIONS = _sled_view_configure,_sled_view_status,_sled_frame_count,')
    if path.read_text() != text:
        path.write_text(text)
    print('Prepared pinned emulator source hooks.')


if __name__ == '__main__':
    main()

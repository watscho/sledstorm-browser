"""Run the browser-generated GPU's real GP0 parser, IRQ latch and GP1 ack."""
import importlib.util
import subprocess
from pathlib import Path
root=Path(__file__).resolve().parent.parent
upstream=root/'research/port/psxrecomp/runtime'
spec=importlib.util.spec_from_file_location('gpu_fixture',upstream/'tests/test_gpu_gp0_history_guard.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
stubs=fixture.STUBS_C.replace('void psx_irq_raise(uint32_t bit, uint32_t detail) { (void)bit; (void)detail; }','void psx_irq_raise(uint32_t bit, uint32_t detail) { i_stat |= 1u << bit; }')
for symbol in ('psx_compiled_irq_resume_pc','psx_last_irq_check_pc','psx_netplay_rb_sticky_bb_pc'):
 stubs=stubs.replace(f'uint32_t {symbol} = 0;',f'uint32_t {symbol}(void) {{ return 0; }}')
stubs=stubs.replace('void psx_video_timing_set_pal(int pal) { (void)pal; }','int psx_video_timing_set_pal(int pal) { return pal; }')
stubs+='''
int sled_web_two_player_view(void) { return 0; }
int sled_web_menu_active(void) { return 0; }
int sled_web_hud_owned(uint32_t p) { return 0; }
int sled_web_hud_transform(uint32_t p,int copy,int32_t x[4],int32_t y[4]) { return 0; }
'''
(root/'.cache/gpu-irq-stubs.c').write_text(stubs)
(root/'.cache/gpu-irq-main.c').write_text('''
#include "gpu.h"
#include <assert.h>
#include <stdio.h>
extern uint32_t i_stat;
int main(void) {
 gpu_init(); assert(!(gpu_read_gpustat() & (1u<<24)));
 gpu_write_gp0(0x1FCDE133u); /* Exact word from the four-player crash. */
 assert(gpu_read_gpustat() & (1u<<24)); assert(i_stat & 2u);
 gpu_write_gp1(0x02000000u); assert(!(gpu_read_gpustat() & (1u<<24)));
 /* GPU ack clears its own latch; I_STAT remains until the IRQ controller ack. */
 assert(i_stat & 2u); gpu_write_gp0(0x1F000000u);
 assert(gpu_read_gpustat() & (1u<<24)); gpu_write_gp1(0x00000000u);
 assert(!(gpu_read_gpustat() & (1u<<24)));
 puts("GPU_IRQ_PASSED: real parser, GPUSTAT latch, IRQ1, acknowledge and reset");
}
''')
subprocess.run([str(root/'.cache/emsdk/upstream/emscripten/emcc'),str(root/'.cache/gpu-irq-main.c'),str(root/'.cache/browser-source/gpu_web.c'),str(upstream/'src/gpu_timeline.c'),str(root/'.cache/gpu-irq-stubs.c'),'-I'+str(upstream/'include'),'-I'+str(upstream/'src'),'-I'+str(root/'research/wasm'),'-sENVIRONMENT=node','-sALLOW_MEMORY_GROWTH=1','-o',str(root/'.cache/gpu-irq-test.js')],check=True)
subprocess.run(['node',str(root/'.cache/gpu-irq-test.js')],check=True)

#include "web_hud.h"
#include "cpu_state.h"
#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#define BASE 0x80100000u
#define RACER 0x800DAE20u
#define GP 0x800C1F18u
static uint8_t ram[0x200000];
uint32_t psx_mod_read_word(uint32_t p){uint32_t v;memcpy(&v,ram+(p&0x1fffff),4);return v;}
uint16_t psx_mod_read_half(uint32_t p){uint16_t v;memcpy(&v,ram+(p&0x1fffff),2);return v;}
uint8_t psx_mod_read_byte(uint32_t p){return ram[p&0x1fffff];}
void psx_mod_write_word(uint32_t p,uint32_t v){memcpy(ram+(p&0x1fffff),&v,4);}
void psx_mod_write_byte(uint32_t p,uint8_t v){ram[p&0x1fffff]=v;}
int sled_web_online_enabled(void){return 1;}
int sled_web_camera_mode(void){return 2;}
static void quad(unsigned slot,int x0,int y0,int x1,int y1){
 uint32_t p=BASE+slot*80;psx_mod_write_word(p,9u<<24);psx_mod_write_word(p+4,0x2cffffff);
 for(unsigned v=0;v<4;v++)psx_mod_write_word(p+8+v*8,(uint16_t)(v&1?x1:x0)|((uint32_t)(v&2?y1:y0)<<16));
}
static unsigned calls;
uint32_t psx_mod_call_guest(CPUState *cpu,uint32_t fn,uint32_t ret,uint32_t a,uint32_t b,uint32_t c,uint32_t d){
 (void)ret;(void)a;(void)b;(void)c;(void)d;assert(fn==0x80061d40u);
 assert(psx_mod_read_word(RACER)==(calls%2?33u:8u));assert(psx_mod_read_word(0x800D6A10u)==2);
 unsigned slot=psx_mod_read_half(cpu->gpr[28]+0x205a);
 assert(!psx_mod_read_byte(0x800DE648u+slot));psx_mod_write_byte(0x800DE648u+slot,1);
 quad(slot,396,220,476,242);quad(slot+1,28,16,256,31);
 psx_mod_write_word(cpu->gpr[28]+0x2058,(slot+2)<<16);calls++;return 0;
}
int main(void){
 memcpy(ram+0x10634,"load81.psh",11);memcpy(ram+0x10604,"load91.psh",11);sled_web_hud_tag();
 assert(!strcmp((char*)ram+0x10634,"load81.psh"));
 psx_mod_write_word(0x800D6A10u,2);sled_web_hud_tag();
 assert(!memcmp(ram+0x10634,"load61.psh",11));assert(!memcmp(ram+0x10604,"load61.psh",11));
 CPUState cpu={0};cpu.gpr[28]=GP;cpu.gpr[31]=0x8006c7e8;
 psx_mod_write_word(0x800D6A10u,4);sled_web_hud_tag();
 assert(!strcmp((char*)ram+0x10634,"load81.psh"));
 assert(!strcmp((char*)ram+0x10604,"load91.psh"));
 psx_mod_write_word(0x800D6A10u,2);sled_web_hud_tag();
 psx_mod_write_word(0x800D6980u,1);psx_mod_write_word(0x800D6A10u,2);psx_mod_write_word(0x800C1F58u,BASE);
 psx_mod_write_word(GP+0x2058,55u<<16);psx_mod_write_word(RACER,8);psx_mod_write_word(RACER+0x530,33);
 assert(sled_web_single_hud(&cpu));assert(calls==2);assert(psx_mod_read_word(RACER)==8);assert(psx_mod_read_word(RACER+0x530)==33);
 int32_t x[4]={0},y[4]={0};assert(sled_web_hud_transform(BASE+55*80,-1,x,y));
 assert(x[0]==213&&x[1]==243&&y[0]==220&&y[2]==242);
 assert(sled_web_hud_transform(BASE+57*80,-1,x,y));assert(x[0]==469&&x[1]==499&&y[0]==220);
 assert(!sled_web_hud_shared(BASE+55*80));assert(!sled_web_hud_transform(BASE+4*80,-1,x,y));
 psx_mod_write_word(BASE+55*80+8,0);assert(!sled_web_hud_transform(BASE+55*80,-1,x,y));
 psx_mod_write_word(GP+0x2058,55u<<16);assert(sled_web_single_hud(&cpu));assert(calls==4);
 psx_mod_write_word(0x800C34E0u,1);assert(sled_web_menu_active());
 assert(!sled_web_hud_owned(BASE+55*80));
 assert(!sled_web_hud_transform(BASE+55*80,-1,x,y));
 psx_mod_write_word(0x800C34E0u,0);assert(!sled_web_menu_active());assert(sled_web_hud_owned(BASE+55*80));
 puts("ORIGINAL_SINGLE_HUD_PASSED");
}

/* Use the original PAL single-player HUD builder for both online seats.
 * Both clients build the same two HUDs. Only presentation coordinates differ
 * from the original; the temporary racer binding is restored before return. */
#include "web_hud.h"
#include "web_network.h"
#include "mod_plugins.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef struct { uint32_t p,xy[4]; int seat; } Hud;
static Hud items[512];
int sled_web_two_player_view(void) { return psx_mod_read_word(0x800D6A10u)==2; }
/* PAL pause enter 8006D004 sets GP+15C8 (800C34E0); resume 8006D0F8
 * clears it. The race flag stays set while this native menu is open. */
int sled_web_menu_active(void) { return psx_mod_read_word(0x800C34E0u)!=0; }
static unsigned count;
static int ready;
int sled_web_hud_shared(uint32_t p){(void)p;return 0;}
int sled_web_hud_owned(uint32_t p){
 if(sled_web_menu_active()||!ready||sled_web_camera_mode()!=2||psx_mod_read_word(0x800D6A10u)!=2)return 0;
 for(unsigned i=0;i<count;i++)if((items[i].p&0x1fffffffu)==(p&0x1fffffffu))return 1;
 return 0;
}
void sled_web_hud_tag(void){
 /* Audited PAL data strings, not instructions. The original loader selects
  * load8[1..4].psh for two-player races; those omit HDL0..5. load6[1..4]
  * contains the original single-player panels and matching atlas metadata.
  * Redirect before the race resource load, leaving the disc unchanged. */
 if(!sled_web_online_enabled()||sled_web_camera_mode()!=2)return;
 const uint32_t names[]={0x80010634u,0x80010628u,0x8001061cu,0x80010610u,
 0x80010604u,0x800105f8u,0x800105ecu,0x800105e0u};
 for(unsigned i=0;i<8;i++){
  uint32_t p=names[i];
  if(psx_mod_read_word(p)==0x64616f6cu && (psx_mod_read_byte(p+4)==(i<4?'8':'9')||psx_mod_read_byte(p+4)=='6') &&
     psx_mod_read_byte(p+5)=='1'+i%4 && psx_mod_read_word(p+6)==0x6873702eu)
    { const uint8_t atlas=sled_web_two_player_view()?'6':(i<4?'8':'9');
      if(psx_mod_read_byte(p+4)!=atlas) { psx_mod_write_byte(p+4,atlas); printf("HUD atlas %c selected at %08x\n",atlas,p); } }
 }
}
static int ram(uint32_t p,unsigned n){return p>=0x80000000u&&p<=0x80200000u-n;}
static void remember(uint32_t table,unsigned first,unsigned end,int seat){
 for(unsigned s=first;s<end;s++)for(unsigned f=0;f<2;f++){
  uint32_t p=table+s*80+f*40;
  if(psx_mod_read_word(p)>>24!=9||(psx_mod_read_byte(p+7)&0xfc)!=0x2c)continue;
  Hud *h=&items[count++];h->p=p;h->seat=seat;
  for(unsigned v=0;v<4;v++)h->xy[v]=psx_mod_read_word(p+8+v*8);
 }
}
int sled_web_hud_transform(uint32_t p,int copy,int32_t x[4],int32_t y[4]){
 (void)copy;
 if(sled_web_menu_active()||!ready||sled_web_camera_mode()!=2||psx_mod_read_word(0x800D6A10u)!=2||psx_mod_read_word(0x800D6980u)!=1||psx_mod_read_word(0x800C3CA0u)!=0)return 0;
 for(unsigned k=0;k<count;k++){
  Hud *h=&items[k];if((h->p&0x1fffffffu)!=(p&0x1fffffffu))continue;
  if(psx_mod_read_word(p)>>24!=9||(psx_mod_read_byte(p+7)&0xfc)!=0x2c)return 0;
  int min=512,max=0;
  for(unsigned v=0;v<4;v++){
   if(psx_mod_read_word(p+8+v*8)!=h->xy[v])return 0;
   int sx=(int16_t)h->xy[v];if(sx<min)min=sx;if(sx>max)max=sx;
  }
  /* Original single-player 512x256 layout. Preserve sprite pixel aspect at
   * 16:9 and anchor each component to its original half of the screen. */
  int right=min+max>512;
  for(unsigned v=0;v<4;v++){
   int sx=(int16_t)h->xy[v];
   x[v]=h->seat*256+(right?256:0)+(sx-(right?512:0))*3/8;
   y[v]=(int16_t)(h->xy[v]>>16);
  }
  return 1;
 }
 return 0;
}
int sled_web_single_hud(CPUState *cpu){
 if(!sled_web_online_enabled()||sled_web_camera_mode()!=2||psx_mod_read_word(0x800D6980u)!=1||psx_mod_read_word(0x800D6A10u)!=2)return 0;
 const uint32_t table=psx_mod_read_word(0x800C1F58u),gp=cpu->gpr[28],racer=0x800DAE20u;
 unsigned start=psx_mod_read_half(gp+0x205a);
 if(!ram(table,256*80)||start>100)return 0;
 uint32_t saved[0x530/4],second[0x530/4];
 for(unsigned i=0;i<0x530/4;i++){saved[i]=psx_mod_read_word(racer+i*4);second[i]=psx_mod_read_word(racer+0x530+i*4);}
 count=0;ready=0;
 /* The original slot cache assumes one single-player builder per frame.
  * Two builders can move a widget to a previously cached slot as dynamic
  * counters change. Rebuild HUD slots from the original descriptors; each
  * packet is still linked only once per buffer and no world slot is touched. */
 for(unsigned s=start;s<256;s++)psx_mod_write_byte(0x800DE648u+s,0);
 /* Build with the exact original single-player routine, not re-created
  * panels or guessed scale factors. The shared game stays two-player. */
 psx_mod_call_guest(cpu,0x80061D40u,cpu->gpr[31],0,0,0,0);
 unsigned mid=psx_mod_read_half(gp+0x205a);
 if(mid>256||mid<start){fprintf(stderr,"Single HUD exceeds UI table\n");abort();}
 remember(table,start,mid,0);
 for(unsigned i=0;i<0x530/4;i++)psx_mod_write_word(racer+i*4,second[i]);
 psx_mod_call_guest(cpu,0x80061D40u,cpu->gpr[31],0,0,0,0);
 unsigned end=psx_mod_read_half(gp+0x205a);
 for(unsigned i=0;i<0x530/4;i++)psx_mod_write_word(racer+i*4,saved[i]);
 if(end>256||end<mid){fprintf(stderr,"Second single HUD exceeds UI table\n");abort();}
 remember(table,mid,end,1);ready=1;
 static int logged;if(!logged++){
  printf("Original single-player HUD: slots %u..%u / %u..%u\n",start,mid,mid,end);
  for(unsigned i=0;i<count;i++){Hud *h=&items[i];int x=(int16_t)h->xy[0],y=(int16_t)(h->xy[0]>>16);
   if(h->seat==0&&((y<=24&&x<40)||(y>=214&&x>=380)))printf("HUD packet %08x xy=%08x/%08x uv=%08x/%08x op=%08x\n",h->p,h->xy[0],h->xy[3],psx_mod_read_word(h->p+12),psx_mod_read_word(h->p+20),psx_mod_read_word(h->p+4));
  }
 }
 return 1;
}

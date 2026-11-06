#include "web_progress.h"
#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
static uint8_t ram[0x200000], original[sizeof ram];
uint8_t psx_mod_read_byte(uint32_t p) { return ram[p & 0x1fffff]; }
uint16_t psx_mod_read_half(uint32_t p) { uint16_t v; memcpy(&v, ram+(p&0x1fffff),2); return v; }
uint32_t psx_mod_read_word(uint32_t p) { uint32_t v; memcpy(&v, ram+(p&0x1fffff),4); return v; }
void psx_mod_write_byte(uint32_t p,uint8_t v) { ram[p & 0x1fffff] = v; }
void psx_mod_write_half(uint32_t p,uint16_t v) { memcpy(ram+(p&0x1fffff),&v,2); }
void sled_progress_configure(int);
uint32_t sled_progress_word(int);
int main(void) {
    memset(ram, 0xa5, sizeof ram); memcpy(original,ram,sizeof ram);
    sled_progress_configure(0); sled_web_progress_tick();
    assert(!memcmp(ram,original,sizeof ram));
    sled_web_progress_tick(); /* disabled profile never writes */
    sled_progress_configure(1);
    sled_web_progress_tick(); /* uninitialized frontend: no writes */
    assert(!memcmp(ram,original,sizeof ram));
    uint32_t race=0; memcpy(ram+0xd6980,&race,4); memcpy(original+0xd6980,&race,4);
    uint32_t frontend=1; memcpy(ram+0xc3ca0,&frontend,4); memcpy(original+0xc3ca0,&frontend,4);
    sled_web_progress_tick();
    assert(sled_progress_word(1)==1);
    sled_web_progress_tick(); assert(sled_progress_word(1)==1);
    assert(sled_progress_word(2)==56 && sled_progress_word(5)==3 && sled_progress_word(6)==1);
    for (unsigned i=0;i<8;i++) {
        assert(ram[0xe3b48+i*2]==5 && ram[0xe3b49+i*2]==4);
        assert(ram[0xd6ae8+i*2]==(i+1)%8 && ram[0xd6ae9+i*2]==(i+7)%8);
    }
    unsigned course=0, visited=0;
    for (unsigned i=0;i<15;i++) {
        assert(!(visited & (1u<<course))); visited |= 1u<<course;
        unsigned next=ram[0xd6af8+course*2];
        assert(ram[0xd6af9+next*2]==course); course=next;
    }
    assert(course==0 && visited==0x7fff);
    assert(sled_progress_word(3)==8 && sled_progress_word(4)==6);
    /* No cash, controls, race state, guest code, or adjacent save fields change. */
    memcpy(original+0xe3b48,ram+0xe3b48,16);
    memcpy(original+0xd7438,ram+0xd7438,56);
    memcpy(original+0xd6ae8,ram+0xd6ae8,16);
    memcpy(original+0xc2ebc,ram+0xc2ebc,12);
    memcpy(original+0xd6af8,ram+0xd6af8,30);
    memcpy(original+0xc2eca,ram+0xc2eca,4);
    assert(!memcmp(ram,original,sizeof ram));
    memcpy(original,ram,sizeof ram);
    sled_web_progress_tick();
    assert(!memcmp(ram,original,sizeof ram));
    /* A profile reset is restored at the next menu, never during a race. */
    race=1; memcpy(ram+0xd6980,&race,4); ram[0xd7439]=0;
    sled_web_progress_tick(); assert(ram[0xd7439]==0 && sled_progress_word(1)==1);
    race=0; memcpy(ram+0xd6980,&race,4);
    sled_web_progress_tick(); assert(ram[0xd7439]==2 && sled_progress_word(1)==2);
    puts("UNLOCK_PROFILE_PASSED");
}

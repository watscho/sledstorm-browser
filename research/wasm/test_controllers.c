/* Reuse the upstream real-SIO test's device/IRQ stubs, not a mock bus. */
#define starvation_ring_record legacy_starvation_stub
#define card_read_summary_record legacy_card_summary_stub
#define main upstream_digital_command_main
#include "../port/psxrecomp/runtime/tests/test_sio_digital_command.c"
#undef main
#undef starvation_ring_record
#undef card_read_summary_record
#include "starvation_ring.h"
#include "card_read_summary.h"
void starvation_ring_record(uint8_t a,uint8_t b,uint8_t c,uint16_t d,uint16_t e,int f,int g,int h,int i,int j,uint8_t k,uint32_t l,uint8_t m,uint8_t n,uint8_t o,uint8_t p,int q) {}
void card_read_summary_record(uint8_t a,uint8_t b,uint16_t c,uint8_t d,uint8_t e,const uint8_t *f) {}
int memcard_last_flush_result(int card) { return 0; }
#include "web_controllers.h"
int main(void) {
    const uint16_t pads[4]={0xFFFE,0xFFFD,0xFFFB,0xFFF7};
    sio_init();sled_web_apply_controller_row(pads);
    expect("first address",0xFF,transfer(0,1));
    expect("first A ID",0x41,transfer(0,0x42));
    expect("REQ marker",0x5A,transfer(0,1));
    expect("A low",0xFE,transfer(0,0));
    expect("A high",0xFF,transfer(0,0));sio_write(CTRL,0);
    /* Simulate the next synchronized VBlank between the two hardware polls. */
    sled_web_apply_controller_row(pads);
    expect("bulk address",0xFF,transfer(0,1));
    expect("bulk ID survives frame",0x80,transfer(0,0x42));
    expect("bulk marker",0x5A,transfer(0,0));
    for(unsigned slot=0;slot<4;slot++){
        expect("slot ID",0x41,transfer(0,0));expect("slot marker",0x5A,transfer(0,0));
        expect("slot low",pads[slot]&255,transfer(0,0));expect("slot high",pads[slot]>>8,transfer(0,0));
        for(unsigned i=0;i<4;i++)transfer(0,0);
    }
    printf("MULTITAP_FRAME_BRIDGE: %u checks, %u failures\n",checks,failures);
    return failures?1:0;
}

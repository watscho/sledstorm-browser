#include "web_controllers.h"
#include "sio.h"
void sled_web_apply_controller_row(const uint16_t pads[4]) {
    /* Setting the port resets the TAP/REQ latch. Never do it every VBlank:
     * libpad needs the request from one poll to survive until its next poll. */
    if (sio_get_multitap_port() != 0) sio_set_multitap_port(0);
    if (!sio_get_multitap()) {
        sio_set_multitap(1);
        for (int slot=0;slot<4;slot++) {
            sio_set_pad_config_capable(slot,0);
            sio_set_pad_analog(slot,0,128,128,128,128);
        }
    }
    /* Original Sled Storm 3/4-player wiring: port 1 A-D, port 2 unused. */
    sio_set_pad_connected(4,0);
    for (int slot=0;slot<4;slot++) {
        sio_set_pad_connected(slot,1);
        sio_set_pad_state_slot(slot,pads[slot]);
        sio_set_pad_sticks(slot,128,128,128,128);
    }
}

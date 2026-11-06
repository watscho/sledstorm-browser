/* PAL SLES-02194 only. Applies the completed result of the audited progress
 * builder (8006BEB4) before controller exchange / CRC at character selection.
 * No card or disc is edited. Both peers apply identical canonical RAM changes.
 * See docs/unlocked-profile.md for the audited fields and limitations. */
#include "web_progress.h"
#include "mod_plugins.h"
#include <emscripten/emscripten.h>
#include <stdint.h>

static int enabled;
static unsigned rebuilds;
EMSCRIPTEN_KEEPALIVE void sled_progress_configure(int unlock) { enabled = !!unlock; }

void sled_web_progress_tick(void) {
    const uint32_t frontend = psx_mod_read_word(0x800C3CA0u);
    if (!enabled || (frontend != 1 && frontend != 2) || psx_mod_read_word(0x800D6980u) != 0) return;
    /* Only write when the original game has initialized/reset a profile. */
    int complete = psx_mod_read_half(0x800C2EC0u) == 8 && psx_mod_read_half(0x800C2EC2u) == 6 &&
        psx_mod_read_half(0x800C2EC4u) == 1 && psx_mod_read_half(0x800C2EC6u) == 1 &&
        psx_mod_read_half(0x800C2ECAu) == 1 && psx_mod_read_half(0x800C2ECCu) == 1;
    for (unsigned i=0; complete && i<56; ++i) complete = psx_mod_read_byte(0x800D7438u+i) == 2;
    if (complete) return;
    for (unsigned rider = 0; rider < 8; ++rider) {
        psx_mod_write_byte(0x800E3B48u + rider * 2, 5); /* Mountain complete */
        psx_mod_write_byte(0x800E3B49u + rider * 2, 4); /* Snocross complete */
        for (unsigned sled = 0; sled < 7; ++sled)
            psx_mod_write_byte(0x800D7438u + rider * 7 + sled, 2); /* owned */
    }
    psx_mod_write_half(0x800C2EC4u, 1); /* secret rider, original password flag */
    psx_mod_write_half(0x800C2EC6u, 1); /* Jackal */
    psx_mod_write_half(0x800C2ECAu, 1); /* demo course, original password flag */
    psx_mod_write_half(0x800C2ECCu, 1); /* mirror */
    /* Exact maximum-progress branch of 8006BEB4: eight Mountain, six
     * Snocross, progression options, and full original circular selectors.
     * With the demo flag on, the native builder leaves all 15 course links. */
    psx_mod_write_half(0x800C2EBCu, 1);
    psx_mod_write_half(0x800C2EBEu, 1);
    psx_mod_write_half(0x800C2EC0u, 8);
    psx_mod_write_half(0x800C2EC2u, 6);
    for (unsigned course = 0; course < 15; ++course) {
        psx_mod_write_byte(0x800D6AF8u + course * 2, (course + 1) % 15);
        psx_mod_write_byte(0x800D6AF9u + course * 2, (course + 14) % 15);
    }
    for (unsigned rider = 0; rider < 8; ++rider) {
        psx_mod_write_byte(0x800D6AE8u + rider * 2, (rider + 1) % 8);
        psx_mod_write_byte(0x800D6AE9u + rider * 2, (rider + 7) % 8);
    }
    ++rebuilds;
}

/* Read-only acceptance probe: counts canonical state, not the requested flag. */
EMSCRIPTEN_KEEPALIVE uint32_t sled_progress_word(int field) {
    if (field == 0) return enabled;
    if (field == 1) return rebuilds;
    if (field == 2) {
        unsigned owned = 0;
        for (unsigned i = 0; i < 56; ++i)
            owned += psx_mod_read_byte(0x800D7438u + i) == 2;
        return owned;
    }
    if (field == 3) return psx_mod_read_half(0x800C2EC0u);
    if (field == 4) return psx_mod_read_half(0x800C2EC2u);
    if (field == 5) return psx_mod_read_half(0x800C2EC4u) | (psx_mod_read_half(0x800C2EC6u) << 1);
    if (field == 6) return psx_mod_read_half(0x800C2ECCu);
    return 0;
}

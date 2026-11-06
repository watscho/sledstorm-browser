/* Browser-only presentation preferences. No authoritative game state changes. */
#include "web_preferences.h"
#include "host_osd.h"
#include <emscripten/emscripten.h>
#include <stdlib.h>
static int volume = 80;
EMSCRIPTEN_KEEPALIVE void sled_preferences_configure(int level, int scale) {
    volume = level < 0 ? 0 : level > 100 ? 100 : level;
    setenv("PSX_INTERNAL_RESOLUTION", scale == 1 ? "1x" : "2x", 1);
    host_volume_set(volume);
}
EMSCRIPTEN_KEEPALIVE void sled_volume_set(int level) {
    volume = level < 0 ? 0 : level > 100 ? 100 : level;
    host_volume_set(volume);
}
EMSCRIPTEN_KEEPALIVE int sled_volume_get(void) { return host_volume_get(); }
void sled_web_preferences_apply(void) { host_volume_set(volume); }

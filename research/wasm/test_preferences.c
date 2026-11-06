#include "web_preferences.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static int actual;
void host_volume_set(int level) { actual=level; }
int host_volume_get(void) { return actual; }
void sled_preferences_configure(int,int);
void sled_volume_set(int);
int sled_volume_get(void);
int main(void) {
    sled_preferences_configure(35,1);
    assert(actual==35 && !strcmp(getenv("PSX_INTERNAL_RESOLUTION"),"1x"));
    actual=100; sled_web_preferences_apply(); assert(actual==35);
    sled_volume_set(-1); assert(sled_volume_get()==0);
    sled_volume_set(120); assert(sled_volume_get()==100);
    sled_preferences_configure(25,99);
    assert(actual==25 && !strcmp(getenv("PSX_INTERNAL_RESOLUTION"),"2x"));
    puts("BROWSER_PREFERENCES_PASSED");
}

#include "psx_fiber.h"
#include <assert.h>
#include <stdio.h>

static psx_fiber_t root;
static int phase;
static void child(void *arg) {
    volatile int preserved = *(int *)arg;
    assert(phase == 0);
    phase = 1;
    psx_fiber_switch(root);
    assert(phase == 2 && preserved == 12345);
    phase = 3;
    psx_fiber_switch(root);
    assert(!"a destroyed fiber must not resume");
}
int main(void) {
    root = psx_fiber_convert_thread();
    assert(root == psx_fiber_current());
    int argument = 12345;
    psx_fiber_t fiber = psx_fiber_create(65536, child, &argument);
    assert(fiber);
    psx_fiber_switch(fiber);
    assert(phase == 1 && root == psx_fiber_current());
    phase = 2;
    psx_fiber_switch(fiber);
    assert(phase == 3 && root == psx_fiber_current());
    psx_fiber_destroy(fiber);
    puts("PASS: separate Wasm stacks preserve locals across repeated switches");
    return 0;
}

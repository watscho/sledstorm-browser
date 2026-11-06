/* Project-local WebAssembly backend for the psx_fiber.h interface.
 * Uses real cooperative stacks; no ucontext stubs or nested dispatch. */
#include "psx_fiber.h"
#include <emscripten/fiber.h>
#include <stdlib.h>

typedef struct WebFiber {
    emscripten_fiber_t context;
    void *stack;
    void *async_stack;
} WebFiber;

static WebFiber *current;
enum { ASYNC_STACK_BYTES = 4 * 1024 * 1024 };

psx_fiber_t psx_fiber_convert_thread(void) {
    if (current) return current;
    WebFiber *fiber = calloc(1, sizeof(*fiber));
    if (!fiber) abort();
    fiber->async_stack = malloc(ASYNC_STACK_BYTES);
    if (!fiber->async_stack) abort();
    emscripten_fiber_init_from_current_context(&fiber->context,
        fiber->async_stack, ASYNC_STACK_BYTES);
    current = fiber;
    return fiber;
}

psx_fiber_t psx_fiber_current(void) { return current; }

psx_fiber_t psx_fiber_create(size_t size, psx_fiber_entry entry, void *arg) {
    if (!entry) return NULL;
    if (size < 65536) size = 65536;
    WebFiber *fiber = calloc(1, sizeof(*fiber));
    if (!fiber) return NULL;
    fiber->stack = malloc(size);
    fiber->async_stack = malloc(ASYNC_STACK_BYTES);
    if (!fiber->stack || !fiber->async_stack) {
        free(fiber->stack); free(fiber->async_stack); free(fiber);
        return NULL;
    }
    emscripten_fiber_init(&fiber->context, entry, arg, fiber->stack, size,
        fiber->async_stack, ASYNC_STACK_BYTES);
    return fiber;
}

void psx_fiber_switch(psx_fiber_t target) {
    WebFiber *to = target;
    if (!to || to == current) return;
    if (!current) abort();
    WebFiber *from = current;
    current = to;
    emscripten_fiber_swap(&from->context, &to->context);
}

void psx_fiber_destroy(psx_fiber_t handle) {
    WebFiber *fiber = handle;
    if (!fiber) return;
    if (fiber == current || !fiber->stack) abort();
    free(fiber->stack); free(fiber->async_stack); free(fiber);
}

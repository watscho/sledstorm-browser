/* Exercise actual adapter conversion with strided/skipped WebGL pixel stores.
 * No GPU is mocked and this does not claim to test the hardware pipeline. */
#include "web_gl_compat.c"
#include <assert.h>

int main(void) {
    const unsigned char compact[] = {
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
        13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    };
    unsigned char strided[96], recovered[sizeof compact];
    memset(strided, 0xee, sizeof strided);
    PixelStore state = {5, 1, 1, 8}; /* 24-byte rows, one skipped row/pixel */
    swap_rows(strided, compact, 3, 2, state, 0);
    assert(strided[28] == 3 && strided[29] == 2 && strided[30] == 1 && strided[31] == 4);
    assert(strided[52] == 15 && strided[53] == 14 && strided[54] == 13 && strided[55] == 16);
    assert(strided[0] == 0xee && strided[27] == 0xee && strided[40] == 0xee && strided[64] == 0xee);
    swap_rows(recovered, strided, 3, 2, state, 1);
    assert(memcmp(recovered, compact, sizeof compact) == 0);
    puts("PASS: BGRA/RGBA conversion preserves channels, alpha, stride, skips and padding");
    return 0;
}

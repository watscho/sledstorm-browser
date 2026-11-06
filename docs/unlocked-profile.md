# All-content browser profile (PAL SLES-02194)

The browser launch page defaults to **All content unlocked**. Turn it off before launch
for original progression. A v4 room invitation carries the unlock setting; the
guest inherits it, and the mode is part of the content identity checked before
joining. Both peers execute the same hooks and retain normal physics and timers.

This is an in-memory session preset, applied after frontend initialization
and reapplied if the game resets its unlock state. It does not edit the disc,
the original emulator launcher, or `saves/card*.mcd`. It is not an imported
memory-card save and does not invent best times, scores, or race records.

## Audited PAL fields

The PAL executable is SHA-256
`86951ada61b1aa0fcd24b142130d3e4325bfdee7067074aa961857924af04b6c`.
Do not transplant these addresses to another game region or PS2 Sled Storm.

| Address | Meaning / preset |
| --- | --- |
| `800E3B48 + rider*2` | Eight riders: Mountain stage 5, Snocross stage 4 |
| `800D7438 + rider*7 + sled` | 56 ownership states set to 2, including Storm |
| `800C2EC4`, `800C2EC6` | Both secret-rider flags = 1 |
| `800C2ECA` | Demo course availability = 1 |
| `800C2ECC` | Mirror availability = 1 |
| `800D6AE8` | Original eight-rider circular selector, all links restored |

`sled_web_progress_tick` runs before controller exchange and state CRC in the
shared frame callback, including offline launches. It only writes in frontend
modes 1/2 while no race is active, and skips already-unlocked profiles. This
places the preset before character selection and restores it after a reset.

The derived maximum-progress state follows the audited original builder
`8006BEB4..8006C364`: eight Mountain and six Snocross courses, progression
options (`800C2EBC`, `800C2EBE`), eight circular rider links, and fifteen circular
course links including the demo. These are selection links, not course IDs.
No guest calls, generated-code replacements or instruction patches are needed.
Upstream source and the original launcher remain unchanged.

`web_progress.c` contains no cash, speed, timer, opponent or
invincibility modifications. A read-only runtime probe reports the actual
canonical ownership counts, track counts, secret flags and rebuild count.

Validation results are recorded in [verification.md](verification.md).

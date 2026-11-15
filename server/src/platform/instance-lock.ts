// Kernel advisory lock that proves a single running server. The kernel drops
// it when the holder exits, so a crash leaves nothing stale to take over.
import { closeSync, constants, openSync } from 'node:fs';

// O_EXLOCK from <sys/fcntl.h> on macOS. Node.js does not export it.
const O_EXLOCK = 0x20;

/** Returns a release function, or null when another process holds the lock. */
export function acquireInstanceLock(file: string): (() => void) | null {
  if (process.platform !== 'darwin')
    throw new Error(`Instance locking is not implemented for ${process.platform} yet.`);
  let descriptor: number;
  try {
    descriptor = openSync(file, constants.O_RDWR | constants.O_CREAT | constants.O_NONBLOCK | O_EXLOCK, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EAGAIN') return null;
    throw error;
  }
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    closeSync(descriptor);
  };
}

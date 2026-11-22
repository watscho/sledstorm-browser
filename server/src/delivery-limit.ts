// One limit on the disc deliveries that the host runs at once, with a short
// queue in order of arrival (D94). A delivery past the queue is refused at
// once, so a crowd of requests never becomes an unbounded backlog.

export class DeliveryBusyError extends Error {}

export interface DeliveryLimit {
  /**
   * Resolves with a release function once a place is free; rejects at once with DeliveryBusyError when every place
   * and the queue are taken, and with the signal's reason when it aborts first.
   */
  acquire(signal: AbortSignal): Promise<() => void>;
  readonly running: number;
  readonly queued: number;
}

interface Waiter {
  grant(): void;
}

export function createDeliveryLimit({ active, waiting }: { active: number; waiting: number }): DeliveryLimit {
  let running = 0;
  const queue: Waiter[] = [];

  const releaser = () => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      // The place passes to the first waiter, so the count only falls when nobody waits.
      const next = queue.shift();
      if (next) next.grant();
      else running -= 1;
    };
  };

  return {
    get running() { return running; },
    get queued() { return queue.length; },
    acquire(signal) {
      if (signal.aborted) return Promise.reject(signal.reason);
      if (running < active) {
        running += 1;
        return Promise.resolve(releaser());
      }
      if (queue.length >= waiting) return Promise.reject(new DeliveryBusyError('The server is busy. Try again shortly.'));
      return new Promise((resolve, reject) => {
        const leave = () => {
          const at = queue.indexOf(waiter);
          if (at >= 0) queue.splice(at, 1);
          reject(signal.reason);
        };
        const waiter: Waiter = {
          grant() {
            signal.removeEventListener('abort', leave);
            resolve(releaser());
          },
        };
        queue.push(waiter);
        signal.addEventListener('abort', leave, { once: true });
      });
    },
  };
}

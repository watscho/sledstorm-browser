// The server's one room. A session of it is a dedicated room on the relay
// with its emulator; when a session ends by itself, the next one opens under
// the same name, so the invitation stays good. The game that was running is
// gone with its emulator: a new session is a new game, not a reconnection.
// A save that a player loads into the room is not a new session: the room
// stays, and is `restoring` until that player is back in it. A new game that
// the host asks for ends the session and opens the next one at once.
import { setTimeout as delay } from 'node:timers/promises';
import type { Log } from './log.ts';

/** `restoring`: the room is there and its links are good, and it takes nobody else while a save is loading. */
export type RoomState = 'off' | 'starting' | 'open' | 'restoring' | 'restarting' | 'failed';

/** One session, as the relay's `createRoom` returns it. */
export interface RoomSession {
  /** Resolves when the emulator listens; rejects when the session ends first. */
  ready: Promise<void>;
  /** Resolves with the reason, whoever ended the session. */
  ended: Promise<string>;
  stop(reason: string): void;
}

/** What a session tells its keeper while it runs. */
export interface RoomEvents {
  /** A save started to load into the session, or that load is over, whichever way it went. */
  restoring(active: boolean): void;
}

export interface RoomTiming {
  /** The pause before each new session after one that ended by itself. After the last, the room has failed. */
  restartDelaysMs: number[];
  /** A session that stayed open this long earns the pauses back. */
  stableMs: number;
}

export interface RoomKeeper {
  state(): RoomState;
  /** Why the last session ended, in the relay's words, or null when none has ended. */
  reason(): string | null;
  /** Opens the room, or tries again after it failed. */
  start(): void;
  /**
   * A new game: the session that runs is ended and the next one opens at once, under the same name, with
   * the count of failed sessions at zero. A pause between two sessions ends now. A room that has failed is
   * started again, and one whose session is starting is left as it is: that game is a new one already.
   * False when the room is off.
   */
  renew(): boolean;
  /** Ends the session and resolves once it has ended. */
  stop(): Promise<void>;
}

const defaults: RoomTiming = { restartDelaysMs: [2000, 4000, 8000], stableMs: 60_000 };

/** What the players of a session that a new game ends are told. */
export const NEW_GAME = 'The host started a new game. Open the invitation again to join.';

export function keepRoom({ open, log, onChange, timing: custom }: {
  open: (events: RoomEvents) => RoomSession;
  log: Log;
  onChange?: () => void;
  timing?: Partial<RoomTiming>;
}): RoomKeeper {
  const timing = { ...defaults, ...custom };
  let state: RoomState = 'off';
  let run: AbortController | null = null;
  let session: RoomSession | null = null;
  let lastReason: string | null = null;
  let work: Promise<void> = Promise.resolve();
  // A new game was asked for: the session that ends now is followed by the next at once, and counts no failure.
  let renewing = false;
  // Set during a pause between two sessions; a new game ends the pause.
  let pausing: AbortController | null = null;

  const set = (next: RoomState) => {
    if (state === next) return;
    state = next;
    onChange?.();
  };

  async function supervise(signal: AbortSignal): Promise<void> {
    let failures = 0;
    set('starting');
    for (;;) {
      let reason = 'The room could not be opened';
      let opened: number | null = null;
      // Only the session that the room runs on moves it, and only between open and restoring: a session
      // that has ended, or is being stopped, has nothing more to say about the room. A session that ends
      // during a load says that the load is over just before it ends, so the log line claims no more.
      let live = true;
      const events: RoomEvents = {
        restoring(active) {
          if (!live || signal.aborted || renewing || state !== (active ? 'open' : 'restoring')) return;
          set(active ? 'restoring' : 'open');
          log(active ? 'The room is loading a saved game.' : 'The load of the saved game is over.');
        },
      };
      try {
        const current = session = open(events);
        try {
          await current.ready;
          if (!signal.aborted) {
            opened = performance.now();
            set('open');
            log('The room is open.');
          }
        } catch { /* It ended before its emulator listened; the reason follows. */ }
        reason = await current.ended;
      } catch (error) {
        log(`The room could not be opened: ${(error as Error).name}`);
      } finally {
        live = false;
        session = null;
      }
      if (signal.aborted) return;
      lastReason = reason;
      if (renewing) {
        renewing = false;
        failures = 0;
        log('The host started a new game.');
        set('starting');
        continue;
      }
      if (opened !== null && performance.now() - opened >= timing.stableMs) failures = 0;
      const pause = timing.restartDelaysMs[failures];
      failures += 1;
      if (pause === undefined) {
        log(`The room ended (${reason}) and is not opened again.`);
        return set('failed');
      }
      log(`The room ended (${reason}). A new session opens in ${pause} ms.`);
      set('restarting');
      const paused = pausing = new AbortController();
      try { await delay(pause, undefined, { signal: AbortSignal.any([signal, paused.signal]) }); }
      catch {
        if (signal.aborted) return;
        // A new game ended the pause.
        failures = 0;
        log('The host started a new game.');
        set('starting');
      } finally { pausing = null; }
    }
  }

  function start(): void {
    // A room that has failed is kept by nobody, even while the run that gave it up is still returning.
    if (run && state !== 'failed') return;
    renewing = false;
    const abort = run = new AbortController();
    work = supervise(abort.signal)
      .catch(error => {
        log(`The room stopped on an unexpected error: ${(error as Error).name}`);
        set('failed');
      })
      .finally(() => { if (run === abort) run = null; });
  }

  return {
    state: () => state,
    reason: () => lastReason,
    start,
    renew() {
      if (state === 'off') return false;
      if (state === 'failed') {
        start();
      } else if (state === 'restarting') {
        pausing?.abort();
      } else if ((state === 'open' || state === 'restoring') && session && !renewing) {
        renewing = true;
        session.stop(NEW_GAME);
      }
      return true;
    },
    async stop() {
      run?.abort();
      session?.stop('Dedicated server stopped');
      await work;
      renewing = false;
      set('off');
    },
  };
}

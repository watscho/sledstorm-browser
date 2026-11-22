// How a browser gets into the panel. The launcher asks the running server
// for a one-time token, with the control credential, and opens the panel with
// it; the page trades it for a session and sends that as a bearer header.
// Nothing here is a cookie: a cookie for 127.0.0.1 goes to every port of that
// address, so the game page and any other local web server would receive it.
import { createHash, randomBytes } from 'node:crypto';

export interface PanelSessions {
  /** A token that opens one session. It is good once, and only for a short while. */
  mintBootstrap(): string;
  /** The session that a one-time token opens, or null when the token is unknown, used or too old. */
  exchange(bootstrap: string): string | null;
  has(session: string): boolean;
}

const TOKEN = /^[a-f0-9]{64}$/;
const newToken = () => randomBytes(32).toString('hex');
// Tokens are kept by their SHA-256, so that looking one up tells nothing about it by its timing.
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

export function createPanelSessions({ bootstrapMs = 60_000, maxBootstraps = 8, maxSessions = 16, now = () => performance.now() }: {
  /** How long a one-time token is good for. It passes through a command line and may stay in a browser's history. */
  bootstrapMs?: number;
  maxBootstraps?: number;
  /** Sessions last as long as the server runs; the one that was not used for longest goes when there are more than this. */
  maxSessions?: number;
  now?: () => number;
} = {}): PanelSessions {
  // The tokens keep the order in which they were made, so the first key is the oldest. The sessions keep
  // the order in which they were last used: a tab that is open and asking is the last to lose its session.
  const bootstraps = new Map<string, number>();
  const sessions = new Set<string>();
  const trim = (kept: Map<string, number> | Set<string>, limit: number) => {
    for (const oldest of kept.keys()) {
      if (kept.size <= limit) break;
      kept.delete(oldest);
    }
  };

  return {
    mintBootstrap() {
      const token = newToken();
      bootstraps.set(digest(token), now());
      trim(bootstraps, maxBootstraps);
      return token;
    },
    exchange(bootstrap) {
      if (!TOKEN.test(bootstrap)) return null;
      const key = digest(bootstrap);
      const made = bootstraps.get(key);
      if (made === undefined) return null;
      bootstraps.delete(key);
      if (now() - made >= bootstrapMs) return null;
      const session = newToken();
      sessions.add(digest(session));
      trim(sessions, maxSessions);
      return session;
    },
    has(session) {
      if (!TOKEN.test(session)) return false;
      const key = digest(session);
      if (!sessions.delete(key)) return false;
      sessions.add(key);
      return true;
    },
  };
}

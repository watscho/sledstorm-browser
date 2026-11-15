import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Paths } from './paths.ts';

export type Log = (message: string) => void;

/** Lifecycle log. Callers never pass credentials, invitations or disc paths. */
export function createLog(paths: Paths, echo: boolean): Log {
  const file = join(paths.logRoot, 'server.log');
  return message => {
    const line = `${new Date().toISOString()} ${message}\n`;
    try { appendFileSync(file, line, { mode: 0o600 }); } catch { /* Logging never stops the server. */ }
    if (echo) process.stderr.write(line);
  };
}

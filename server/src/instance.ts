// One server per user: a kernel lock held by the running server, a private
// record that says how to reach it, and an authenticated probe. A PID alone is
// never trusted, because the system reuses PIDs.
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Paths } from './paths.ts';

export interface InstanceRecord {
  instance: string;
  pid: number;
  port: number;
  /** Control credential. It stays in this private file and is never logged. */
  token: string;
  startedAt: string;
  version: string;
  /**
   * The checksum of the server's code in the runtime manifest that it read at its start: what tells its build
   * from another of the same version. Null for a server run from source, and for one of an earlier build,
   * which wrote no such key.
   */
  build: string | null;
}

const recordFile = (paths: Paths) => join(paths.dataRoot, 'instance.json');
export const instanceLockFile = (paths: Paths) => join(paths.dataRoot, 'instance.lock');

export async function writeInstanceRecord(paths: Paths, record: InstanceRecord): Promise<void> {
  const temporary = `${recordFile(paths)}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
  await rename(temporary, recordFile(paths));
}

export async function readInstanceRecord(paths: Paths): Promise<InstanceRecord | null> {
  let value: unknown;
  try { value = JSON.parse(await readFile(recordFile(paths), 'utf8')); } catch { return null; }
  if (typeof value !== 'object' || value === null) return null;
  const { instance, pid, port, token, startedAt, version, build = null } = value as Record<string, unknown>;
  if (typeof instance !== 'string' || !/^[a-f0-9]{16}$/.test(instance)) return null;
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return null;
  if (typeof port !== 'number' || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  if (typeof startedAt !== 'string' || typeof version !== 'string') return null;
  if (build !== null && (typeof build !== 'string' || !/^[a-f0-9]{64}$/.test(build))) return null;
  return { instance, pid, port, token, startedAt, version, build };
}

/** Removes the record only when it still describes the given instance. */
export async function removeInstanceRecord(paths: Paths, instance: string): Promise<void> {
  if ((await readInstanceRecord(paths))?.instance === instance) await rm(recordFile(paths), { force: true });
}

/** `sent`, when given, goes as the JSON body. */
async function call(record: InstanceRecord, method: string, path: string, timeoutMs: number, sent?: object): Promise<Response | null> {
  try {
    return await fetch(`http://127.0.0.1:${record.port}${path}`, {
      method, signal: AbortSignal.timeout(timeoutMs),
      headers: { authorization: `Bearer ${record.token}`, ...(sent && { 'content-type': 'application/json' }) },
      ...(sent && { body: JSON.stringify(sent) }),
    });
  } catch { return null; }
}

/** The status report of the recorded server, or null when nothing answers with its credential. */
export async function fetchStatus(record: InstanceRecord): Promise<{ instance?: unknown; host?: unknown } | null> {
  const response = await call(record, 'GET', '/api/status', 1000);
  if (response?.status !== 200) return null;
  try { return await response.json() as { instance?: unknown; host?: unknown }; }
  catch { return null; }
}

/** The links to the server's room, or null when it has no room or does not answer. `url` is null without a public address. */
export async function fetchInvitation(record: InstanceRecord): Promise<{ url: string | null; localUrl: string | null } | null> {
  const response = await call(record, 'GET', '/api/invitation', 1000);
  if (response?.status !== 200) return null;
  try {
    const { url, localUrl } = await response.json() as { url?: unknown; localUrl?: unknown };
    return { url: typeof url === 'string' ? url : null, localUrl: typeof localUrl === 'string' ? localUrl : null };
  } catch { return null; }
}

/** True when the recorded server answers with its own identity. */
export async function isLive(record: InstanceRecord): Promise<boolean> {
  return (await fetchStatus(record))?.instance === record.instance;
}

export async function findLiveInstance(paths: Paths): Promise<InstanceRecord | null> {
  const record = await readInstanceRecord(paths);
  return record && await isLive(record) ? record : null;
}

export async function waitForInstance(paths: Paths, timeoutMs: number): Promise<InstanceRecord | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const record = await findLiveInstance(paths);
    if (record || Date.now() >= deadline) return record;
    await delay(100);
  }
}

/**
 * A one-time token that lets a browser's page into the panel, or null when the server gives none.
 * It is a credential for a minute: it goes into the address that is opened and nowhere else.
 */
export async function requestBootstrap(record: InstanceRecord): Promise<string | null> {
  const response = await call(record, 'POST', '/api/session/bootstrap', 2000);
  if (response?.status !== 201) return null;
  try {
    const { bootstrap } = await response.json() as { bootstrap?: unknown };
    return typeof bootstrap === 'string' && /^[a-f0-9]{64}$/.test(bootstrap) ? bootstrap : null;
  } catch { return null; }
}

/** What the server said to a request about hosting: 202 with the host's status, or a refusal with its sentence. */
export interface HostingAnswer {
  status: number;
  host?: unknown;
  error?: unknown;
  players?: unknown;
}

async function hostingAnswer(response: Response | null): Promise<HostingAnswer | null> {
  if (!response) return null;
  try { return { ...await response.json() as object, status: response.status }; }
  catch { return null; }
}

/**
 * Asks the recorded server to start hosting; `force` also when the start ends a room that has players.
 * Null when it does not answer.
 */
export const requestStart = async (record: InstanceRecord, force = false): Promise<HostingAnswer | null> =>
  hostingAnswer(await call(record, 'POST', '/api/host/start', 2000, force ? { force: true } : undefined));

/** Asks the recorded server to stop hosting; `force` also when players are in the room. Null when it does not answer. */
export const requestStop = async (record: InstanceRecord, force: boolean): Promise<HostingAnswer | null> =>
  hostingAnswer(await call(record, 'POST', '/api/room/stop', 2000, force ? { force: true } : undefined));

/** Asks the recorded server for a new game in its room; `force` also when players are in it. Null when it does not answer. */
export const requestNewGame = async (record: InstanceRecord, force: boolean): Promise<HostingAnswer | null> =>
  hostingAnswer(await call(record, 'POST', '/api/room/new-game', 2000, force ? { force: true } : undefined));

/** The diagnostic report of the recorded server, or null when it gives none, as a server of an earlier build does not. */
export async function requestDiagnostics(record: InstanceRecord): Promise<object | null> {
  const response = await call(record, 'POST', '/api/diagnostics/export', 5000);
  if (response?.status !== 200) return null;
  try {
    const report: unknown = await response.json();
    return typeof report === 'object' && report !== null && !Array.isArray(report) ? report : null;
  } catch { return null; }
}

/**
 * Asks the recorded server to quit; `force` also when players are in the room. Null when it does not answer.
 * A server of an earlier build quits without asking.
 */
export const requestQuit = async (record: InstanceRecord, force = false): Promise<HostingAnswer | null> =>
  hostingAnswer(await call(record, 'POST', '/api/host/quit', 2000, force ? { force: true } : undefined));

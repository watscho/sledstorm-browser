// The long-running server. Start is a transaction: a failed step releases
// everything this start acquired. Stop is safe to request more than once.
import { startHostServer, type HostServer } from './host-server.ts';
import { createHostService, type HostService } from './host-service.ts';
import { instanceLockFile, removeInstanceRecord, writeInstanceRecord } from './instance.ts';
import { createLog } from './log.ts';
import { ensureWritableRoots, type Paths } from './paths.ts';
import { acquireInstanceLock } from './platform/instance-lock.ts';
import { appVersion } from './version.ts';

export const EXIT_ALREADY_RUNNING = 3;

/** A port override for tests. The web client itself expects ports 8000 and 8006. */
function testPort(name: string): number | undefined {
  const value = process.env[name];
  if (value === undefined || value === '') return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error(`${name} must be a port number from 1024 to 65535.`);
  return port;
}

export async function serve(paths: Paths, { echo }: { echo: boolean }): Promise<number> {
  await ensureWritableRoots(paths);
  const log = createLog(paths, echo);
  const release = acquireInstanceLock(instanceLockFile(paths));
  if (!release) {
    log('Another server instance holds the lock; not starting a second one.');
    return EXIT_ALREADY_RUNNING;
  }

  let host: HostServer | undefined;
  let service: HostService | undefined;
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  let stopping: Promise<void> | undefined;
  const stop = (reason: string) => stopping ??= (async () => {
    log(`Stopping: ${reason}.`);
    await service?.stop();
    if (host) {
      await host.close();
      await removeInstanceRecord(paths, host.instance);
    }
    release();
    log('Stopped.');
    finish();
  })();

  try {
    const hosting = service = createHostService({ paths, log,
      gamePort: testPort('SLED_SERVER_GAME_PORT'), netplayPort: testPort('SLED_SERVER_NETPLAY_PORT') });
    host = await startHostServer({ version: appVersion, onQuit: () => { void stop('quit request'); },
      status: () => hosting.status() });
    await writeInstanceRecord(paths, { instance: host.instance, pid: process.pid, port: host.port,
      token: host.token, startedAt: host.startedAt, version: appVersion });
  } catch (error) {
    await stop('startup failed');
    throw error;
  }
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => { void stop(signal); });
  log(`Ready on 127.0.0.1:${host.port}, instance ${host.instance}, version ${appVersion}.`);
  console.log(JSON.stringify({ event: 'ready', port: host.port, instance: host.instance }));
  // Hosting starts in the background: preparing a disc takes a while, and the
  // control listener must answer meanwhile.
  void service.start();
  await finished;
  return 0;
}

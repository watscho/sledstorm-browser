// The long-running server. Start is a transaction: a failed step releases
// everything this start acquired. Stop is safe to request more than once.
import { isAbsolute, join } from 'node:path';
import { isSea } from 'node:sea';
import { readConfig } from './config-store.ts';
import { chosenBrowser } from './dedicated.ts';
import { createHostControl, type HostControl } from './host-control.ts';
import { startHostServer, type HostServer } from './host-server.ts';
import { createHostService, shippedTunnelProgram, type HostService } from './host-service.ts';
import { instanceLockFile, removeInstanceRecord, writeInstanceRecord } from './instance.ts';
import { createLog } from './log.ts';
import { ensureWritableRoots, type Paths } from './paths.ts';
import { systemFolderDialog, type ChooseFolder } from './platform/folder-dialog.ts';
import { acquireInstanceLock } from './platform/instance-lock.ts';
import { currentBuild } from './runtime-manifest.ts';
import { selfCommand } from './self.ts';
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

/**
 * The dialog in which the game folder is chosen: the system's, on macOS. `SLED_SERVER_FOLDER_DIALOG` names
 * a program that stands in for it in tests. A server that was told to open no browser shows no dialog
 * either, unless a stand-in is named: no automated run may put a window on the user's screen.
 */
function folderDialog(): ChooseFolder | undefined {
  const standIn = process.env.SLED_SERVER_FOLDER_DIALOG;
  if (standIn !== undefined && standIn !== '') {
    if (!isAbsolute(standIn)) throw new Error('SLED_SERVER_FOLDER_DIALOG must be an absolute path.');
    return systemFolderDialog(standIn);
  }
  return process.env.SLED_SERVER_NO_BROWSER === '1' || process.platform !== 'darwin' ? undefined : systemFolderDialog();
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
  let control: HostControl | undefined;
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  let stopping: Promise<void> | undefined;
  const stop = (reason: string) => stopping ??= (async () => {
    log(`Stopping: ${reason}.`);
    // A dialog that is still open goes with the server.
    control?.close();
    // For good: the listener answers until hosting has stopped, and a start that it is asked for
    // meanwhile, or the start at launch below, must not bring hosting back.
    await service?.close();
    if (host) {
      await host.close();
      await removeInstanceRecord(paths, host.instance);
    }
    release();
    log('Stopped.');
    finish();
  })();

  try {
    // For tests only: a stand-in tunnel program reports an address that does not exist, so the check of
    // the public address is skipped with it. The program is still guarded against outliving the server.
    const unprobed = process.env.SLED_SERVER_TUNNEL_PROBE === 'off'
      ? { command: { command: shippedTunnelProgram(paths), args: [] }, guard: selfCommand(['internal', 'guard']) }
      : undefined;
    const hosting = service = createHostService({ paths, log, tunnels: unprobed,
      worker: { browser: chosenBrowser({ sea: isSea(), env: process.env, paths }) },
      gamePort: testPort('SLED_SERVER_GAME_PORT'), netplayPort: testPort('SLED_SERVER_NETPLAY_PORT') });
    control = createHostControl({ paths, service: hosting, chooseFolder: folderDialog(), log });
    host = await startHostServer({ version: appVersion, panelRoot: join(paths.resourceRoot, 'admin'), onQuit: () => { void stop('quit request'); },
      status: () => hosting.status(),
      invitation: () => ({ url: hosting.invitation(), localUrl: hosting.localInvitation() }),
      control });
    // A launch of another build tells this server by its build, and may ask it to quit.
    await writeInstanceRecord(paths, { instance: host.instance, pid: process.pid, port: host.port,
      token: host.token, startedAt: host.startedAt, version: appVersion, build: await currentBuild(paths.resourceRoot) });
  } catch (error) {
    await stop('startup failed');
    throw error;
  }
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => { void stop(signal); });
  log(`Ready on 127.0.0.1:${host.port}, instance ${host.instance}, version ${appVersion}.`);
  console.log(JSON.stringify({ event: 'ready', port: host.port, instance: host.instance }));
  // Hosting starts in the background: preparing a disc takes a while, and the
  // control listener must answer meanwhile. A host who switched that off starts
  // it with a request. A file that cannot be used counts as no choice, so the
  // start is tried and the status says what is wrong with the file.
  if ((await readConfig(paths)).config.autoStart) void service.start();
  await finished;
  return 0;
}

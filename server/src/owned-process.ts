// A child process with an owner: a startup deadline, a readiness signal and a
// bounded stop that escalates only for this child.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface ProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface OwnedProcess {
  name: string;
  pid: number;
  exited: Promise<ProcessExit>;
  /** Asks the child to stop, then kills it after `graceMs`. Safe to call again. */
  stop(graceMs?: number): Promise<ProcessExit & { forced: boolean }>;
}

export interface OwnedProcessOptions {
  name: string;
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  /** Returns true for the stdout line that means the child is ready. */
  ready: (line: string) => boolean;
  startupMs: number;
  onLine?: (line: string) => void;
}

export function startOwnedProcess(options: OwnedProcessOptions): Promise<OwnedProcess> {
  const { name, command, args, env, ready, startupMs, onLine } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let started = false;
    let errors = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { errors = (errors + chunk).slice(-2000); });

    let exit: ProcessExit | undefined;
    const exited = new Promise<ProcessExit>(done => {
      child.once('exit', (code, signal) => {
        exit = { code, signal };
        done(exit);
      });
    });
    let stopping: Promise<ProcessExit & { forced: boolean }> | undefined;
    const stop = (graceMs = 5000) => stopping ??= (async () => {
      let forced = false;
      if (!exit) child.kill('SIGTERM');
      const timer = setTimeout(() => {
        if (exit) return;
        forced = true;
        child.kill('SIGKILL');
      }, graceMs);
      const result = await exited;
      clearTimeout(timer);
      return { ...result, forced };
    })();

    const fail = (message: string) => {
      if (started) return;
      started = true;
      clearTimeout(deadline);
      const detail = errors.trim();
      reject(new Error(detail ? `${name}: ${message}\n${detail}` : `${name}: ${message}`));
    };
    const deadline = setTimeout(() => {
      child.kill('SIGKILL');
      fail(`not ready within ${startupMs} ms`);
    }, startupMs);
    child.once('error', error => fail(`could not start (${error.message})`));
    // 'close' follows 'exit' once the output pipes are drained, so the error text is complete.
    child.once('close', (code, signal) => fail(`exited before it was ready (${signal ?? `code ${code}`})`));

    createInterface({ input: child.stdout }).on('line', line => {
      onLine?.(line);
      if (started || !ready(line)) return;
      started = true;
      clearTimeout(deadline);
      resolve({ name, pid: child.pid ?? -1, exited, stop });
    });
  });
}

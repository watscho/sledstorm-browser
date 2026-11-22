// The system's dialog for choosing a folder. A page in a browser cannot give
// the server a path, so the server shows the dialog itself, on its own
// computer, and the path comes out of the dialog only.
import { execFile } from 'node:child_process';
import { isAbsolute } from 'node:path';

/**
 * Shows the dialog and resolves to the folder that was chosen, or to null when the dialog was canceled.
 * It rejects when the dialog could not be shown, and when `signal` ended it.
 */
export type ChooseFolder = (signal: AbortSignal) => Promise<string | null>;

/**
 * The dialog could not be shown. Its message names no folder, and neither does its reason, which is for
 * the log: the exit code and the number of AppleScript's error, or what kept the program from answering.
 */
export class FolderDialogError extends Error {
  reason: string;
  constructor(reason: string) {
    super('The folder dialog could not be shown.');
    this.reason = reason;
  }
}

// The script is fixed. Nothing of a request and no path is ever part of it, and no shell reads it.
// The first line brings the dialog in front of the browser that asked for it.
const SCRIPT = ['-e', 'tell me to activate', '-e',
  'POSIX path of (choose folder with prompt "Choose the folder that holds your Sled Storm disc")'];

/** AppleScript's number for a dialog that the user canceled, as `osascript` prints it. */
const CANCELED = /\(-128\)/;
/** The number of AppleScript's error, which `osascript` prints last. */
const NUMBER = /\((-\d+)\)\s*$/;

/** Why the program gave no folder, in words that name none. */
function why(error: Error & { code?: unknown; signal?: unknown }, stderr: string): string {
  if (error.name === 'AbortError') return 'ended';
  if (typeof error.code === 'number') {
    const number = NUMBER.exec(stderr)?.[1];
    return number === undefined ? `exit ${error.code}` : `exit ${error.code}, error ${number}`;
  }
  if (typeof error.signal === 'string') return `ended by ${error.signal}`;
  return typeof error.code === 'string' ? `not started (${error.code})` : 'no answer';
}

/** The dialog of macOS, shown by the system's `osascript`. `program` stands in for it in tests. */
export function systemFolderDialog(program = '/usr/bin/osascript'): ChooseFolder {
  return signal => new Promise((resolve, reject) => {
    const failed = (reason: string) => reject(new FolderDialogError(reason));
    execFile(program, SCRIPT, { signal, encoding: 'utf8', maxBuffer: 16 * 1024 }, (error, stdout, stderr) => {
      // What the program says about an error may name the user's folders, so none of its words are passed on.
      if (error) return error.code === 1 && CANCELED.test(stderr) ? resolve(null) : failed(why(error, stderr));
      // The answer ends with one line break. A folder's own name may hold one, and may end in a space.
      const folder = stdout.endsWith('\n') ? stdout.slice(0, -1) : stdout;
      return isAbsolute(folder) ? resolve(folder) : failed('no folder in the answer');
    });
  });
}

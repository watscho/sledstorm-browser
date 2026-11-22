import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { FolderDialogError, systemFolderDialog } from '../src/platform/folder-dialog.ts';
import { scratch } from './fixtures.ts';

// No test opens the system's dialog: each one names a program of its own in place of `osascript`.

/** A program in place of `osascript`: a shell script with the given body. */
async function standIn(root: string, body: string): Promise<string> {
  const program = join(root, 'stand-in osascript');
  await writeFile(program, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return program;
}

const never = () => new AbortController().signal;

test('the dialog\'s answer is the folder, whatever its name', async t => {
  const root = await scratch(t, 'dialog');
  const record = join(root, 'arguments.txt');
  const answer = join(root, 'answer.txt');
  const choose = systemFolderDialog(await standIn(root, `printf '%s\\n' "$#" "$@" > '${record}'\ncat '${answer}'`));
  const folders = ['/Users/somebody/Games/Sled Storm/', '/Volumes/Disc/a "quoted" folder/', '/Volumes/Disc/an owner\'s folder/',
    '/Volumes/Disc/雪 Снег/', '/Volumes/Disc/-rf/', '/Volumes/Disc/$(touch nothing) `id`/', '/Volumes/Disc/two\nlines/', '/'];
  for (const folder of folders) {
    // The system's program ends its answer with one line break.
    await writeFile(answer, `${folder}\n`);
    assert.equal(await choose(never()), folder);
  }
  // The script is fixed: nothing of a request, and no path, is part of it.
  assert.deepEqual((await readFile(record, 'utf8')).split('\n'), ['4', '-e', 'tell me to activate', '-e',
    'POSIX path of (choose folder with prompt "Choose the folder that holds your Sled Storm disc")', '']);
});

test('a cancel is no folder and no error', async t => {
  const root = await scratch(t, 'dialog');
  const choose = systemFolderDialog(await standIn(root, 'echo "0:17: execution error: User canceled. (-128)" >&2\nexit 1'));
  assert.equal(await choose(never()), null);
});

test('a dialog that cannot be shown is an error that names no path', async t => {
  const root = await scratch(t, 'dialog');
  // The reason is for the log: the exit code and the number of AppleScript's error, never its words.
  const failures: Record<string, [body: string, reason: string]> = {
    'another error of the script': ['echo "execution error: Not authorized to show /Users/somebody/Private (-5). (-1743)" >&2\nexit 1', 'exit 1, error -1743'],
    'a cancel with another exit code': ['echo "execution error: User canceled. (-128)" >&2\nexit 2', 'exit 2, error -128'],
    'a number that only begins like a cancel': ['echo "execution error: Something else. (-1280)" >&2\nexit 1', 'exit 1, error -1280'],
    'an error without a number': ['echo "/Users/somebody/Private is gone" >&2\nexit 3', 'exit 3'],
    'no answer': ['exit 0', 'no folder in the answer'],
    'an answer that is no full path': ['echo "alias Macintosh HD:Users:somebody:Games:"', 'no folder in the answer'],
  };
  const shownNot = (name: string, reason: string) => (error: Error) => {
    assert.ok(error instanceof FolderDialogError, name);
    assert.equal(error.message, 'The folder dialog could not be shown.', name);
    assert.equal(error.reason, reason, name);
    return true;
  };
  for (const [name, [body, reason]] of Object.entries(failures)) {
    await assert.rejects(systemFolderDialog(await standIn(root, body))(never()), shownNot(name, reason));
  }
  await assert.rejects(systemFolderDialog(join(root, 'no such program'))(never()), shownNot('no such program', 'not started (ENOENT)'));
});

test('a dialog is ended by its signal', async t => {
  const root = await scratch(t, 'dialog');
  const noted = join(root, 'pid.txt');
  const choose = systemFolderDialog(await standIn(root, `echo $$ > '${noted}'\nexec /bin/sleep 30`));
  const stop = new AbortController();
  const answer = choose(stop.signal);
  let pid = 0;
  for (let attempt = 0; !pid && attempt < 250; attempt++) {
    pid = Number((await readFile(noted, 'utf8').catch(() => '')).trim());
    if (!pid) await delay(20);
  }
  assert.ok(pid > 0, 'the stand-in runs');
  stop.abort();
  await assert.rejects(answer, (error: Error) => error instanceof FolderDialogError && error.reason === 'ended');
  const alive = () => {
    try { process.kill(pid, 0); return true; } catch { return false; }
  };
  for (let attempt = 0; alive() && attempt < 250; attempt++) await delay(20);
  assert.equal(alive(), false, 'nothing is left of the dialog');
});

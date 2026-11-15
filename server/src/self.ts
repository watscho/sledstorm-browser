import { isSea } from 'node:sea';

/** Command line that starts this same program again with other arguments. */
export function selfCommand(args: string[]): { command: string; args: string[] } {
  // The packaged executable is its own interpreter. A development run repeats its script path.
  const script = isSea() ? [] : [process.argv[1] ?? ''];
  return { command: process.execPath, args: [...script, ...args] };
}

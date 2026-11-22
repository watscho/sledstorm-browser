// Command dispatch. Importing this module starts nothing; `entry.ts` runs it.
import { isAbsolute } from 'node:path';
import { configure, diagnostics, invitation, launch, newGame, quit, start, status, stop } from './control.ts';
import { internal } from './internal.ts';
import { currentPaths } from './paths.ts';
import { openBrowser } from './platform/open-browser.ts';
import { selfTest } from './self-test.ts';
import { serve } from './serve.ts';
import { appVersion } from './version.ts';

const usage = `Usage: SledStormServer [command]

  (no command)  Open the server window in the macOS app
  panel         Open the server controls in a browser
  configure     Save the game folder and the disc policy
  serve         Run the server in the foreground
  start         Start hosting on the running server; --force when it closes a room with players
  stop          Stop hosting and keep the server running; --force with players in the room
  new-game      Start a new game in the room, under the same links; --force with players in the room
  status        Report whether a server is running
  invitation    Print the private links to the room: for guests, and for this computer
  quit          Stop the running server; --force with players in the room
  diagnostics   Print a report for finding a fault, without folders or secrets
  self-test     Check this executable and print a JSON report
  --version     Print the version`;

/**
 * For tests only: a program that takes the panel's address in place of the system's opener. It is run
 * even when `SLED_SERVER_NO_BROWSER` is set, so a test that sets both can never open a real browser.
 */
function standInOpener(): string | undefined {
  const program = process.env.SLED_SERVER_OPENER;
  if (program === undefined || program === '') return undefined;
  if (!isAbsolute(program)) throw new Error('SLED_SERVER_OPENER must be an absolute path.');
  return program;
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === 'internal') return internal(rest);
  if (command === '--version') {
    console.log(appVersion);
    return 0;
  }
  if (command === '--help') {
    console.log(usage);
    return 0;
  }
  const paths = currentPaths();
  switch (command) {
    case '--native-panel': return launch(paths, { openPanel: false, nativePanel: true });
    case undefined:
    case 'panel': {
      const opener = standInOpener();
      return launch(paths, { openPanel: opener !== undefined || process.env.SLED_SERVER_NO_BROWSER !== '1',
        open: url => openBrowser(url, opener) });
    }
    case 'configure': return configure(paths, rest);
    case 'serve': return serve(paths, { echo: process.stderr.isTTY === true, launcher: rest[0] === '--launcher' });
    case 'start': return start(paths, rest);
    case 'stop': return stop(paths, rest);
    case 'new-game': return newGame(paths, rest);
    case 'status': return status(paths);
    case 'invitation': return invitation(paths);
    case 'quit': return quit(paths, rest);
    case 'diagnostics': return diagnostics(paths);
    case 'self-test': return selfTest(paths);
    default:
      console.error(usage);
      return 2;
  }
}

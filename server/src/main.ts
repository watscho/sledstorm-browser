// Command dispatch. Importing this module starts nothing; `entry.ts` runs it.
import { configure, invitation, launch, quit, status } from './control.ts';
import { internal } from './internal.ts';
import { currentPaths } from './paths.ts';
import { selfTest } from './self-test.ts';
import { serve } from './serve.ts';
import { appVersion } from './version.ts';

const usage = `Usage: SledStormServer [command]

  (no command)  Open the server page, starting the server first when needed
  configure     Save the game folder and the disc policy
  serve         Run the server in the foreground
  status        Report whether a server is running
  invitation    Print the private links to the room: for guests, and for this computer
  quit          Stop the running server
  self-test     Check this executable and print a JSON report
  --version     Print the version`;

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
    case undefined: return launch(paths, { openPanel: process.env.SLED_SERVER_NO_BROWSER !== '1' });
    case 'configure': return configure(paths, rest);
    case 'serve': return serve(paths, { echo: process.stderr.isTTY === true });
    case 'status': return status(paths);
    case 'invitation': return invitation(paths);
    case 'quit': return quit(paths);
    case 'self-test': return selfTest(paths);
    default:
      console.error(usage);
      return 2;
  }
}

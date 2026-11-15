// Executable entry point for the bundle and the single executable application.
import { main } from './main.ts';

main(process.argv.slice(2)).then(code => process.exit(code), error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

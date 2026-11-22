import { execFile } from 'node:child_process';

/** The panel's address as the launcher builds it: plain, or with a one-time token as its fragment. */
const PANEL_ADDRESS = /^http:\/\/127\.0\.0\.1:\d{1,5}\/(?:#bootstrap=[a-f0-9]{64})?$/;

/**
 * Opens the panel in the user's default browser. The address is built by the launcher, never typed,
 * and anything else is refused. `program` stands in for the system's opener in tests.
 */
export function openBrowser(url: string, program?: string): Promise<void> {
  if (!PANEL_ADDRESS.test(url)) return Promise.reject(new Error('Refusing to open an address that is not the panel\'s.'));
  if (program === undefined && process.platform !== 'darwin')
    return Promise.reject(new Error(`Opening a browser is not implemented for ${process.platform} yet.`));
  return new Promise((resolve, reject) => {
    execFile(program ?? '/usr/bin/open', [url], error => error ? reject(error) : resolve());
  });
}

import { execFile } from 'node:child_process';

/** Opens a loopback URL in the user's default browser. The URL is built by the server, never typed. */
export function openBrowser(url: string): Promise<void> {
  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}\/[\w\-./]*$/.test(url)) return Promise.reject(new Error('Refusing to open a non-loopback address.'));
  if (process.platform !== 'darwin')
    return Promise.reject(new Error(`Opening a browser is not implemented for ${process.platform} yet.`));
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/open', [url], error => error ? reject(error) : resolve());
  });
}

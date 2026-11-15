declare const __APP_VERSION__: string | undefined;

/** Wrapper version, injected by the bundler. An unbundled development run reports a placeholder. */
export const appVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';

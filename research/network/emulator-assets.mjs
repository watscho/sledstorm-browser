export function emulatorAssetPaths(lock, discMode) {
  if (!['shared', 'local'].includes(discMode)) throw new Error('Invalid disc mode');
  return new Set(['/', '/app.js', '/frame-sync.js', '/core-state.js', '/pal-profile.js',
    '/sled-storm-logo.png', '/controls.js', '/controls-ui.js', '/lobby-ui.js', '/sled-storm-pal-cover.jpg', '/local-disc.js', '/disc-identity.js', '/invitation.js', '/session-client.js', '/style.css',
    '/session-info', '/network-core.data', ...(discMode === 'shared' ? ['/disc.zip'] : []),
    ...Object.keys(lock.files).map(name => '/emulator/' + name)]);
}

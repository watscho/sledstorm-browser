export function emulatorAssetPaths(lock, discMode) {
  if (!['shared', 'local'].includes(discMode)) throw new Error('Invalid disc mode');
  return new Set(['/', '/app.js', '/display.js', '/solo-save.js', '/retroarch-netplay.js', '/frame-sync.js', '/core-state.js', '/pal-profile.js',
    '/sled-storm-logo.png', '/playstation-controller.svg', '/controls.js', '/controls-ui.js', '/lobby-ui.js', '/sled-storm-pal-cover.jpg', '/local-disc.js', '/disc-identity.js', '/game-data-folder.js', '/invitation.js', '/session-client.js', '/style.css',
    '/session-info', '/network-core.data', '/lobby-mountains.svg', '/lobby-snow-trail.svg', '/shaders/sharp-bilinear.glsl', '/shaders/crt-lottes.glsl', ...(discMode === 'shared' ? ['/disc.zip'] : []),
    ...Object.keys(lock.files).map(name => '/emulator/' + name)]);
}

import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { resolvePaths, type PathInputs } from '../src/paths.ts';

const packaged: PathInputs = {
  sea: true,
  execPath: '/Volumes/Games Disk/Sled Storm Server.app/Contents/MacOS/SledStormServer',
  platform: 'darwin',
  env: {},
  home: '/Users/Алиса Example',
  temp: '/private/var/tmp',
};

test('a packaged executable finds resources inside its application bundle', () => {
  assert.equal(resolvePaths(packaged).resourceRoot, '/Volumes/Games Disk/Sled Storm Server.app/Contents/Resources');
});

test('a bare packaged executable finds resources beside itself', () => {
  const paths = resolvePaths({ ...packaged, execPath: '/opt/sled storm/SledStormServer' });
  assert.equal(paths.resourceRoot, '/opt/sled storm/resources');
});

test('the packaged resource root ignores the development override', () => {
  const paths = resolvePaths({ ...packaged, env: { SLED_SERVER_RESOURCES: '/somewhere/else' } });
  assert.equal(paths.resourceRoot, '/Volumes/Games Disk/Sled Storm Server.app/Contents/Resources');
});

test('a development run needs an explicit absolute resource directory', () => {
  const development = { ...packaged, sea: false, execPath: '/usr/local/bin/node' };
  assert.throws(() => resolvePaths(development), /SLED_SERVER_RESOURCES/);
  assert.throws(() => resolvePaths({ ...development, env: { SLED_SERVER_RESOURCES: 'relative/resources' } }), /SLED_SERVER_RESOURCES/);
  assert.equal(resolvePaths({ ...development, env: { SLED_SERVER_RESOURCES: '/work/resources' } }).resourceRoot, '/work/resources');
});

test('user data defaults to the macOS library folders of the user', () => {
  const paths = resolvePaths(packaged);
  assert.equal(paths.dataRoot, '/Users/Алиса Example/Library/Application Support/Sled Storm Server');
  assert.equal(paths.cacheRoot, '/Users/Алиса Example/Library/Caches/Sled Storm Server');
  assert.equal(paths.logRoot, '/Users/Алиса Example/Library/Logs/Sled Storm Server');
  assert.equal(paths.tempRoot, '/private/var/tmp');
});

test('SLED_SERVER_HOME relocates every writable root and must be absolute', () => {
  const paths = resolvePaths({ ...packaged, env: { SLED_SERVER_HOME: '/tmp/sled home' } });
  assert.deepEqual([paths.dataRoot, paths.cacheRoot, paths.logRoot],
    ['/tmp/sled home/data', '/tmp/sled home/cache', '/tmp/sled home/logs']);
  assert.throws(() => resolvePaths({ ...packaged, env: { SLED_SERVER_HOME: 'relative' } }), /absolute/);
});

test('a platform without a default data location asks for SLED_SERVER_HOME', () => {
  assert.throws(() => resolvePaths({ ...packaged, platform: 'linux' }), /SLED_SERVER_HOME/);
  assert.equal(resolvePaths({ ...packaged, platform: 'linux', env: { SLED_SERVER_HOME: '/srv/sled' } }).dataRoot, '/srv/sled/data');
});

test('no writable root is inside the read-only resources', () => {
  const paths = resolvePaths(packaged);
  for (const root of [paths.dataRoot, paths.cacheRoot, paths.logRoot, paths.tempRoot])
    assert.ok(!root.startsWith(paths.resourceRoot), root);
});

test('browser profiles live inside the cache root, wherever that is', () => {
  for (const env of [{}, { SLED_SERVER_HOME: '/Volumes/Data/sled home' }]) {
    const paths = resolvePaths({ sea: true, execPath: '/Applications/Sled Storm Server.app/Contents/MacOS/SledStormServer',
      platform: 'darwin', env, home: '/Users/Example', temp: '/private/var/tmp' });
    assert.equal(paths.profileRoot, join(paths.cacheRoot, 'browser-profiles'));
  }
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAppPaths } from '../../lib/paths.mjs';

describe('resolveAppPaths', () => {
  it('uses XDG directories on Linux when provided', () => {
    const paths = resolveAppPaths({
      platform: 'linux',
      homeDir: '/home/alex',
      env: {
        XDG_CONFIG_HOME: '/xdg/config',
        XDG_CACHE_HOME: '/xdg/cache',
      },
    });

    assert.equal(paths.configDir, '/xdg/config/or-info');
    assert.equal(paths.cacheDir, '/xdg/cache/or-info');
    assert.equal(paths.envFile, '/xdg/config/or-info/.env');
  });

  it('falls back to ~/.config and ~/.cache on macOS/Linux', () => {
    const paths = resolveAppPaths({
      platform: 'darwin',
      homeDir: '/Users/alex',
      env: {},
    });

    assert.equal(paths.configDir, '/Users/alex/.config/or-info');
    assert.equal(paths.cacheDir, '/Users/alex/.cache/or-info');
  });

  it('uses APPDATA for config and LOCALAPPDATA for cache on Windows', () => {
    const paths = resolveAppPaths({
      platform: 'win32',
      homeDir: 'C:\\Users\\alex',
      env: {
        APPDATA: 'C:\\Users\\alex\\AppData\\Roaming',
        LOCALAPPDATA: 'C:\\Users\\alex\\AppData\\Local',
      },
    });

    assert.equal(paths.configDir, 'C:\\Users\\alex\\AppData\\Roaming\\or-info');
    assert.equal(paths.cacheDir, 'C:\\Users\\alex\\AppData\\Local\\or-info');
    assert.equal(paths.files.modelsCache, 'C:\\Users\\alex\\AppData\\Local\\or-info\\models.json');
  });

  it('falls back to APPDATA for Windows cache when LOCALAPPDATA is missing', () => {
    const paths = resolveAppPaths({
      platform: 'win32',
      homeDir: 'C:\\Users\\alex',
      env: {
        APPDATA: 'C:\\Users\\alex\\AppData\\Roaming',
      },
    });

    assert.equal(paths.cacheDir, 'C:\\Users\\alex\\AppData\\Roaming\\or-info');
  });

  it('prefers explicit OR_INFO_* overrides on every platform', () => {
    const paths = resolveAppPaths({
      platform: 'linux',
      homeDir: '/home/alex',
      env: {
        OR_INFO_CONFIG_DIR: '/tmp/custom-config',
        OR_INFO_CACHE_DIR: '/tmp/custom-cache',
        XDG_CONFIG_HOME: '/ignored/config',
        XDG_CACHE_HOME: '/ignored/cache',
      },
    });

    assert.equal(paths.configDir, '/tmp/custom-config');
    assert.equal(paths.cacheDir, '/tmp/custom-cache');
    assert.equal(paths.files.benchmarksCache, '/tmp/custom-cache/benchmarks.json');
  });
});

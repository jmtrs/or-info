import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createIsolatedAppEnv, importFresh, setEnv } from '../helpers/runtime.mjs';

describe('loadLeaderboard error handling', () => {
  let isolated;
  let restoreEnv;
  let restoreFetch;

  before(async () => {
    isolated = await createIsolatedAppEnv('lmarena');
    restoreEnv = setEnv({
      OR_INFO_CONFIG_DIR: isolated.configDir,
      OR_INFO_CACHE_DIR: isolated.cacheDir,
    });
  });

  after(async () => {
    restoreFetch?.();
    restoreEnv();
    await isolated.cleanup();
  });

  it('wraps network failures with provider context', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new TypeError('socket hang up');
    };
    restoreFetch = () => {
      global.fetch = originalFetch;
    };

    const { loadLeaderboard } = await importFresh('lib/lmarena.mjs', 'lmarena-network-error');
    await assert.rejects(() => loadLeaderboard({ force: true }), /LMArena request failed: socket hang up/);
  });
});

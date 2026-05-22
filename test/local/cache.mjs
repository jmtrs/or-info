import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { createIsolatedAppEnv, importFresh, setEnv } from '../helpers/runtime.mjs';

describe('cache module', () => {
  let isolated;
  let restoreEnv;
  let cache;
  let paths;

  before(async () => {
    isolated = await createIsolatedAppEnv('cache');
    restoreEnv = setEnv({
      OR_INFO_CONFIG_DIR: isolated.configDir,
      OR_INFO_CACHE_DIR: isolated.cacheDir,
    });
    paths = await importFresh('lib/paths.mjs', 'cache-paths');
    cache = await importFresh('lib/cache.mjs', 'cache-module');
  });

  after(async () => {
    restoreEnv();
    await isolated.cleanup();
  });

  it('round-trips JSON through the real cache module', async () => {
    const data = { foo: 'bar', n: 42, arr: [1, 2, 3] };
    await cache.set(paths.MODELS_CACHE, data);
    const result = await cache.get(paths.MODELS_CACHE, cache.TTL.MODELS);
    assert.deepEqual(result, data);
  });

  it('returns null for a missing cache file', async () => {
    const result = await cache.get(join(paths.CACHE_DIR, 'missing.json'), cache.TTL.MODELS);
    assert.equal(result, null);
  });

  it('marks expired entries as stale', async () => {
    await cache.set(paths.MODELS_CACHE, { stale: true });
    const old = new Date(Date.now() - cache.TTL.MODELS - 5_000);
    await fs.utimes(paths.MODELS_CACHE, old, old);

    const result = await cache.get(paths.MODELS_CACHE, cache.TTL.MODELS);
    assert.equal(result, null);
  });

  it('clear removes one cache file and clearAll removes JSON and temp cache files', async () => {
    await cache.set(paths.MODELS_CACHE, { a: 1 });
    await cache.set(paths.BENCHMARKS_CACHE, { b: 2 });
    await fs.mkdir(paths.CACHE_DIR, { recursive: true });
    await fs.writeFile(join(paths.CACHE_DIR, 'keep.txt'), 'keep');

    await cache.clear(paths.MODELS_CACHE);
    assert.equal(await cache.get(paths.MODELS_CACHE, cache.TTL.MODELS), null);

    await cache.clearAll();
    assert.equal(await cache.get(paths.BENCHMARKS_CACHE, cache.TTL.BENCHMARKS), null);
    assert.equal(await fs.readFile(join(paths.CACHE_DIR, 'keep.txt'), 'utf8'), 'keep');
  });

  it('reports cache status using the configured cache files', async () => {
    await cache.set(paths.MODELS_CACHE, { ok: true });
    const items = await cache.status();

    const models = items.find((item) => item.key === 'models');
    const benchmarks = items.find((item) => item.key === 'benchmarks');

    assert.equal(models.exists, true);
    assert.equal(models.fresh, true);
    assert.equal(benchmarks.exists, false);
  });

  it('uses restricted file permissions on Unix as a best effort', async () => {
    await cache.set(paths.MODELS_CACHE, { secure: true });
    const stat = await fs.stat(paths.MODELS_CACHE);
    const mode = stat.mode & 0o777;

    if (process.platform !== 'win32') {
      assert.equal(mode, 0o600, `Expected 0o600, got 0o${mode.toString(8)}`);
    }
  });
});

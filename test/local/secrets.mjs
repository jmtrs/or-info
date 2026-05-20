import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { createIsolatedAppEnv, importFresh, setEnv } from '../helpers/runtime.mjs';

describe('secrets', () => {
  let isolated;
  let restoreEnv;

  before(async () => {
    isolated = await createIsolatedAppEnv('secrets');
    restoreEnv = setEnv({
      OR_INFO_CONFIG_DIR: isolated.configDir,
      OR_INFO_CACHE_DIR: isolated.cacheDir,
      OPENROUTER_API_KEY: undefined,
    });
    await fs.mkdir(isolated.configDir, { recursive: true });
  });

  after(async () => {
    restoreEnv();
    await isolated.cleanup();
  });

  it('loads OPENROUTER_* values from the configured .env file', async () => {
    await fs.writeFile(join(isolated.configDir, '.env'), "OPENROUTER_API_KEY=sk-or-from-file\n");
    const { getApiKey } = await importFresh('lib/secrets.mjs', 'secrets-file');
    assert.equal(await getApiKey(), 'sk-or-from-file');
  });

  it('lets process env override the configured .env file', async () => {
    await fs.writeFile(join(isolated.configDir, '.env'), "OPENROUTER_API_KEY=sk-or-from-file\n");
    const undoOverride = setEnv({ OPENROUTER_API_KEY: 'sk-or-from-env' });

    try {
      const { getApiKey } = await importFresh('lib/secrets.mjs', 'secrets-env');
      assert.equal(await getApiKey(), 'sk-or-from-env');
    } finally {
      undoOverride();
    }
  });
});

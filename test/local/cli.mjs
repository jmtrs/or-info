import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runCli, parseJson } from '../helpers/online.mjs';
import { createIsolatedAppEnv } from '../helpers/runtime.mjs';

const MODELS = [
  {
    id: 'provider/a',
    name: 'A',
    pricing: { prompt: '0.000001', completion: '0.000001' },
    context_length: 4096,
  },
  {
    id: 'provider/b',
    name: 'B',
    pricing: { prompt: '0.000002', completion: '0.000002' },
    context_length: 8192,
  },
  {
    id: 'provider/c',
    name: 'C',
    pricing: { prompt: '0', completion: '0' },
    context_length: 16384,
  },
];

describe('CLI local behaviour', () => {
  let isolated;

  before(async () => {
    isolated = await createIsolatedAppEnv('cli-local');
    await fs.mkdir(isolated.cacheDir, { recursive: true });
    await fs.writeFile(
      path.join(isolated.cacheDir, 'models.json'),
      JSON.stringify({ data: MODELS })
    );
  });

  after(async () => {
    await isolated.cleanup();
  });

  it('models --limit restricts JSON results without network access', async () => {
    const { stdout } = await runCli(['models', '--limit', '2', '--json'], { env: isolated.env });
    const out = parseJson(stdout);

    assert.equal(out.length, 2);
    assert.deepEqual(out.map((m) => m.id), ['provider/a', 'provider/b']);
  });

  it('top rejects unknown tasks before fetching data', async () => {
    await assert.rejects(
      () => runCli(['top', '--task', 'inventada', '--json'], {
        env: isolated.env,
        expectExit: 0,
      }),
      /Invalid task: inventada/
    );
  });
});

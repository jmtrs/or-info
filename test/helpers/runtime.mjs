import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CLI = join(PROJECT_ROOT, 'bin', 'or-info.mjs');

export async function createIsolatedAppEnv(prefix) {
  const root = await fs.mkdtemp(join(tmpdir(), `or-info-${prefix}-`));
  const configDir = join(root, 'config');
  const cacheDir = join(root, 'cache');

  return {
    root,
    configDir,
    cacheDir,
    env: {
      ...process.env,
      OR_INFO_CONFIG_DIR: configDir,
      OR_INFO_CACHE_DIR: cacheDir,
    },
    cleanup: async () => {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

export function setEnv(overrides) {
  const previous = new Map();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }

  return () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

export async function importFresh(relativePath, tag = 'test') {
  const url = pathToFileURL(join(PROJECT_ROOT, relativePath)).href;
  const nonce = `${tag}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return import(`${url}?fresh=${nonce}`);
}

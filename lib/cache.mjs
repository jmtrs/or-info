import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { CACHE_DIR, MODELS_CACHE, BENCHMARKS_CACHE } from './paths.mjs';

export const TTL = {
  MODELS: 30 * 60 * 1000,       // 30 min
  BENCHMARKS: 24 * 60 * 60 * 1000, // 24 h
};

const IS_WINDOWS = process.platform === 'win32';
const PERMISSION_ERRORS = new Set(['EINVAL', 'ENOSYS', 'EPERM']);

async function chmodBestEffort(path, mode) {
  if (IS_WINDOWS) return;
  try {
    await fs.chmod(path, mode);
  } catch (err) {
    if (!PERMISSION_ERRORS.has(err?.code)) throw err;
  }
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await chmodBestEffort(dir, 0o700);
}

async function readJson(file) {
  try {
    const text = await fs.readFile(file, 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function tempFileFor(file) {
  return join(
    dirname(file),
    `.${basename(file)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  );
}

async function writeJson(file, data) {
  await ensureDir(dirname(file));
  const tmp = tempFileFor(file);

  try {
    await fs.writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
    await fs.rename(tmp, file);
    await chmodBestEffort(file, 0o600);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

async function mtimeMs(file) {
  try {
    const stat = await fs.stat(file);
    return stat.mtimeMs;
  } catch {
    return 0;
  }
}

export async function get(file, ttlMs) {
  const age = Date.now() - (await mtimeMs(file));
  if (age > ttlMs) return null;
  return readJson(file);
}

export async function set(file, data) {
  await writeJson(file, data);
}

export async function clear(file) {
  try {
    await fs.unlink(file);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

export async function clearAll() {
  try {
    const entries = await fs.readdir(CACHE_DIR);
    await Promise.all(
      entries
        .filter((e) => e.endsWith('.json') || e.endsWith('.tmp'))
        .map((e) => fs.unlink(join(CACHE_DIR, e)).catch(() => {}))
    );
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

export async function status() {
  const files = [
    { key: 'models', file: MODELS_CACHE, ttl: TTL.MODELS },
    { key: 'benchmarks', file: BENCHMARKS_CACHE, ttl: TTL.BENCHMARKS },
  ];

  return Promise.all(
    files.map(async ({ key, file, ttl }) => {
      const mtime = await mtimeMs(file);
      const age = mtime ? Date.now() - mtime : null;
      return {
        key,
        exists: mtime > 0,
        ageMs: age,
        fresh: age !== null && age < ttl,
        ttlMs: ttl,
      };
    })
  );
}

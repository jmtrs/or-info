import { homedir } from 'node:os';
import path from 'node:path';

function cleanEnvPath(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function resolveAppPaths({
  platform = process.platform,
  env = process.env,
  homeDir = homedir(),
} = {}) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const join = pathApi.join;
  const resolve = pathApi.resolve;
  const configOverride = cleanEnvPath(env.OR_INFO_CONFIG_DIR);
  const cacheOverride = cleanEnvPath(env.OR_INFO_CACHE_DIR);

  let defaultConfigRoot;
  let defaultCacheRoot;

  if (platform === 'win32') {
    defaultConfigRoot = cleanEnvPath(env.APPDATA) ?? join(homeDir, 'AppData', 'Roaming');
    defaultCacheRoot =
      cleanEnvPath(env.LOCALAPPDATA) ??
      cleanEnvPath(env.APPDATA) ??
      join(homeDir, 'AppData', 'Local');
  } else {
    defaultConfigRoot = cleanEnvPath(env.XDG_CONFIG_HOME) ?? join(homeDir, '.config');
    defaultCacheRoot = cleanEnvPath(env.XDG_CACHE_HOME) ?? join(homeDir, '.cache');
  }

  const configDir = resolve(configOverride ?? join(defaultConfigRoot, 'or-info'));
  const cacheDir = resolve(cacheOverride ?? join(defaultCacheRoot, 'or-info'));
  const envFile = join(configDir, '.env');

  return {
    configDir,
    cacheDir,
    envFile,
    files: {
      modelsCache: join(cacheDir, 'models.json'),
      benchmarksCache: join(cacheDir, 'benchmarks.json'),
    },
  };
}

export const APP_PATHS = resolveAppPaths();
export const CONFIG_DIR = APP_PATHS.configDir;
export const CACHE_DIR = APP_PATHS.cacheDir;
export const ENV_FILE = APP_PATHS.envFile;
export const MODELS_CACHE = APP_PATHS.files.modelsCache;
export const BENCHMARKS_CACHE = APP_PATHS.files.benchmarksCache;

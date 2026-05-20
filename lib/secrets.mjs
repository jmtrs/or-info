import fs from 'node:fs/promises';
import { ENV_FILE } from './paths.mjs';

const ENV_LINE_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

function unquote(v) {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

async function parseEnvFile(file) {
  try {
    const text = await fs.readFile(file, 'utf8');
    const out = {};
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const m = line.match(ENV_LINE_RE);
      if (m) out[m[1]] = unquote(m[2]);
    }
    return out;
  } catch {
    return {};
  }
}

export async function loadEnv() {
  const fileVars = await parseEnvFile(ENV_FILE);
  // Process env takes precedence over file so users can override with shell exports
  return { ...fileVars, ...Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k.startsWith('OPENROUTER_'))
  )};
}

export async function getApiKey() {
  const env = await loadEnv();
  return env.OPENROUTER_API_KEY || null;
}

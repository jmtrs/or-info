import { get, set, TTL } from './cache.mjs';
import { MODELS_CACHE } from './paths.mjs';
import { VERSION } from './version.mjs';

const OR_BASE = 'https://openrouter.ai/api/v1';
const USER_AGENT = `or-info-cli/${VERSION} (https://github.com/jmtrs/or-info)`;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_FETCH_RETRIES = 2;

function retryDelayMs(retryAfter, attempt) {
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const dateMs = Date.parse(retryAfter ?? '');
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());

  return 500 * (attempt + 1);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, apiKey) {
  const headers = { 'User-Agent': USER_AGENT };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  for (let attempt = 0; attempt <= MAX_FETCH_RETRIES; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers });
    } catch (err) {
      if (attempt === MAX_FETCH_RETRIES) {
        throw new Error(`OpenRouter request failed: ${err.message}`);
      }
      await sleep(retryDelayMs(null, attempt));
      continue;
    }

    if (res.ok) return res.json();

    let message = res.statusText;
    try {
      const body = await res.json();
      message = body?.error?.message || body?.message || message;
    } catch {}

    if (attempt === MAX_FETCH_RETRIES || !RETRYABLE_STATUSES.has(res.status)) {
      throw new Error(`OpenRouter ${res.status}: ${message}`);
    }

    await sleep(retryDelayMs(res.headers.get('retry-after'), attempt));
  }

  throw new Error('OpenRouter request failed: exhausted retries');
}

export async function fetchModels({ apiKey, force = false } = {}) {
  if (!force) {
    const cached = await get(MODELS_CACHE, TTL.MODELS);
    if (cached?.data) return cached.data;
  }
  const fresh = await fetchJson(`${OR_BASE}/models`, apiKey);
  await set(MODELS_CACHE, fresh);
  return fresh.data ?? [];
}

export function findModel(models, id) {
  const exact = models.find((m) => m?.id === id);
  if (exact) return exact;
  const norm = (s) => s.replace(/\./g, '-');
  const needle = norm(id);
  return models.find((m) => m?.id && norm(m.id) === needle) ?? null;
}

export function pricePerMillion(model) {
  const p = model?.pricing ?? {};
  const toM = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n * 1_000_000 : null;
  };
  return {
    input: toM(p.prompt),
    output: toM(p.completion),
    image: toM(p.image),
    cacheRead: toM(p.input_cache_read),
    cacheWrite: toM(p.input_cache_write),
  };
}

export function contextLength(model) {
  const raw = model?.top_provider?.context_length ?? model?.context_length;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function maxOutput(model) {
  const n = Number(model?.top_provider?.max_completion_tokens);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function supportsFeature(model, feature) {
  const params = Array.isArray(model?.supported_parameters) ? model.supported_parameters : [];
  const featureMap = {
    reasoning: ['include_reasoning', 'reasoning'],
    tools: ['tools', 'tool_choice'],
    vision: () => {
      // Prefer the canonical modality string (e.g. "text+image->text") because
      // input_modalities is inconsistently populated by OpenRouter providers.
      const modality = model?.architecture?.modality ?? '';
      if (modality) {
        return modality.split('->')[0].split('+').map((s) => s.trim()).includes('image');
      }
      const inputMods = model?.architecture?.input_modalities;
      if (Array.isArray(inputMods)) return inputMods.includes('image');
      return false;
    },
    structured: ['structured_outputs'],
  };
  const check = featureMap[feature];
  if (typeof check === 'function') return check();
  if (Array.isArray(check)) return check.some((f) => params.includes(f));
  return params.includes(feature);
}

export function modelTags(model) {
  const tags = [];
  if (supportsFeature(model, 'reasoning')) tags.push('reasoning');
  if (supportsFeature(model, 'tools')) tags.push('tools');
  if (supportsFeature(model, 'vision')) tags.push('vision');
  if (supportsFeature(model, 'structured')) tags.push('structured');
  const ctx = contextLength(model);
  if (ctx && ctx >= 128_000) tags.push('long-context');
  return tags;
}

export function isFree(model) {
  // A model is genuinely free only if it carries the :free suffix
  // or is a known free-tier model. OpenRouter sometimes reports
  // pricing.prompt="0" & pricing.completion="0" for models that are NOT free
  // (e.g. z-ai/glm-5.1) — a known API inconsistency.
  if (model?.id?.endsWith(':free')) return true;
  if (model?.id === 'openrouter/free') return true;
  return false;
}

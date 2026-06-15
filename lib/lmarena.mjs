import fs from 'node:fs/promises';
import { get, set, TTL } from './cache.mjs';
import { BENCHMARKS_CACHE } from './paths.mjs';
import { VERSION } from './version.mjs';
import * as Parquet from 'hyparquet';

const HF_ROWS =
  'https://datasets-server.huggingface.co/rows?dataset=lmarena-ai%2Fleaderboard-dataset&config=text&split=latest';
const HF_PARQUET_URL =
  'https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset/resolve/main/text/latest-00000-of-00001.parquet';
const PAGE = 100;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_FETCH_RETRIES = 2;
const HF_TOKEN = process.env.HF_TOKEN;

function retryDelayMs(retryAfter, attempt) {
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const dateMs = Date.parse(retryAfter ?? '');
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());

  return 500 * (attempt + 1);
}

async function readJsonFallback(file) {
  try {
    const text = await fs.readFile(file, 'utf8');
    return JSON.parse(text);
  } catch { return null; }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Fetch from Parquet (1 request, preferred method) ──────────────────────

async function fetchBenchmarksFromParquet() {
  const headers = { 'User-Agent': `or-info-cli/${VERSION}` };
  if (HF_TOKEN) headers.Authorization = `Bearer ${HF_TOKEN}`;

  const res = await fetch(HF_PARQUET_URL, {
    headers,
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    throw new Error(`HF Hub parquet fetch failed: ${res.status} ${res.statusText}`);
  }

  // Get the parquet file as ArrayBuffer
  const arrayBuffer = await res.arrayBuffer();

  // Parse Parquet using hyparquet
  const data = await Parquet.parquetReadObjects({
    file: {
      byteLength: arrayBuffer.byteLength,
      slice: (s, e) => Promise.resolve(arrayBuffer.slice(s, e)),
    },
  });

  // Read all rows and group by category
  const byCategory = { overall: [], coding: [], math: [] };
  for (const record of data) {
    const cat = record.category;
    if (WANTED_CATEGORIES.has(cat)) {
      byCategory[cat].push({
        lmarenaName: record.model_name,
        elo: Math.round(record.rating),
        eloLower: Math.round(record.rating_lower),
        eloUpper: Math.round(record.rating_upper),
        votes: Math.round(record.vote_count),
        rank: Math.round(record.rank),
        updatedAt: record.leaderboard_publish_date,
      });
    }
  }

  // Filter empty categories
  for (const cat of Object.keys(byCategory)) {
    if (byCategory[cat].length === 0) delete byCategory[cat];
  }

  return byCategory;
}

// ── Fetch via datasets-server (pagination, for fallback) ────────────────────

async function fetchPage(offset) {
  const url = `${HF_ROWS}&offset=${offset}&length=${PAGE}`;
  for (let attempt = 0; attempt <= MAX_FETCH_RETRIES; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': `or-info-cli/${VERSION}` },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      if (attempt === MAX_FETCH_RETRIES) {
        throw new Error(`LMArena request failed: ${err.message}`);
      }
      await sleep(retryDelayMs(null, attempt));
      continue;
    }

    if (res.ok) return res.json();
    if (attempt === MAX_FETCH_RETRIES || !RETRYABLE_STATUSES.has(res.status)) {
      throw new Error(`LMArena fetch ${res.status}: ${res.statusText}`);
    }

    await sleep(retryDelayMs(res.headers.get('retry-after'), attempt));
  }

  throw new Error('LMArena request failed: exhausted retries');
}

// Categories we actually use. LMArena has ~25 but we only need 3.
// This cuts pages from ~89 to ~12 and avoids HuggingFace 429s.
const WANTED_CATEGORIES = new Set(['overall', 'coding', 'math']);

// Fetch only the wanted category rows from the dataset.
// The dataset is sorted by category so once we've moved past all
// wanted categories we stop early.
// Returns { overall: [...], coding: [...], math: [...] }
async function fetchAllByCategory() {
  const byCategory = {};
  let offset = 0;
  let lastCat = null;
  let passedAllWanted = false;

  while (!passedAllWanted) {
    const page = await fetchPage(offset);
    const rows = page.rows ?? [];
    if (!rows.length) break;

    for (const { row } of rows) {
      const cat = row.category;
      lastCat = cat;
      if (WANTED_CATEGORIES.has(cat)) {
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push({
          lmarenaName: row.model_name,
          elo: Math.round(row.rating),
          eloLower: Math.round(row.rating_lower),
          eloUpper: Math.round(row.rating_upper),
          votes: Math.round(row.vote_count),
          rank: Math.round(row.rank),
          updatedAt: row.leaderboard_publish_date,
        });
      }
    }

    // Stop early: all wanted categories found AND current page moved past them
    const found = Object.keys(byCategory);
    if (found.length === WANTED_CATEGORIES.size && !WANTED_CATEGORIES.has(lastCat)) {
      passedAllWanted = true;
    }

    offset += PAGE;
    if (offset >= (page.num_rows_total ?? Infinity)) break;
  }
  return byCategory;
}

// ── Name normalisation ─────────────────────────────────────────────────────

// Normalise a name for fuzzy matching.
// Rules (applied in order):
//   1. Lowercase
//   2. Dots → hyphens   (4.6 → 4-6)
//   3. Remove date suffixes like -20250929 or -2025-09-29
//   4. Collapse multiple hyphens
function normalise(name) {
  return name
    .toLowerCase()
    .replace(/\./g, '-')
    .replace(/-20\d{2}-?\d{2}-?\d{2,}(-.+)?$/, '')
    .replace(/-{2,}/g, '-')
    .trim();
}

// Extract the "slug" portion of an OpenRouter model ID (after the provider /).
// openai/gpt-4o  →  gpt-4o
// anthropic/claude-opus-4.6  →  claude-opus-4-6  (after normalise)
function orSlug(id) {
  return normalise(id.includes('/') ? id.split('/').slice(1).join('/') : id);
}

// Build a lookup Map from normalised LMArena name → entry.
export function buildIndex(entries) {
  const exact = new Map();
  for (const e of entries) {
    exact.set(normalise(e.lmarenaName), e);
  }
  return exact;
}

// Build a per-category index: { overall: Map<name, entry>, coding: Map<name, entry>, ... }
function buildCategoryIndex(byCategory) {
  const result = {};
  for (const [cat, entries] of Object.entries(byCategory)) {
    result[cat] = buildIndex(entries);
  }
  return result;
}

// Find the best matching LMArena entry for an OpenRouter model ID.
// Returns the entry or null.
export function match(orId, index) {
  const slug = orSlug(orId);

  // 1. Exact slug match
  if (index.has(slug)) return index.get(slug);

  // 2. The OpenRouter slug contains the LMArena key as a substring
  //    e.g. OR "deepseek-chat-v3-0324" ⊇ LMArena "v3-0324"  (too short, skip < 8 chars)
  for (const [key, entry] of index) {
    if (key.length >= 8 && slug.includes(key)) return entry;
  }

  // 3. The LMArena key contains the OR slug
  for (const [key, entry] of index) {
    if (slug.length >= 8 && key.includes(slug)) return entry;
  }

  // 4. Full OR ID normalised (keeping provider prefix stripped differently)
  const fullNorm = normalise(orId.replace('/', '-'));
  if (index.has(fullNorm)) return index.get(fullNorm);

  return null;
}

// ── Public API ─────────────────────────────────────────────────────────────

let _loadingPromise = null;
let _categoryIndex = null; // { overall: Map<name, entry>, coding: Map<name, entry>, ... }
let _byCategory = null;    // { overall: entry[], coding: entry[], ... }

export async function loadLeaderboard({ force = false } = {}) {
  if (force) {
    _loadingPromise = null;
    _byCategory = null;
    _categoryIndex = null;
  }

  if (!force) {
    const cached = await get(BENCHMARKS_CACHE, TTL.BENCHMARKS);
    if (cached?.byCategory) {
      _byCategory = cached.byCategory;
      _categoryIndex = buildCategoryIndex(cached.byCategory);
      return cached.byCategory;
    }
  }

  // Share in-flight promise: concurrent callers await the same fetch
  if (_loadingPromise) return await _loadingPromise;

  _loadingPromise = (async () => {
    // Try fetchBenchmarksFromParquet first (1 request, no pagination)
    let byCategory = null;
    let lastError = null;

    try {
      byCategory = await fetchBenchmarksFromParquet();
    } catch (err) {
      lastError = err;
      console.warn(`Parquet fetch failed: ${err.message}. Falling back to datasets-server...`);
    }

    // If parquet failed or returned empty, try datasets-server
    if (!byCategory || Object.keys(byCategory).length === 0) {
      try {
        byCategory = await fetchAllByCategory();
      } catch (err) {
        lastError = err;
        // Both methods failed. Try stale cache.
        const stale = await readJsonFallback(BENCHMARKS_CACHE);
        if (stale?.byCategory) {
          console.warn(`All fetch methods failed (${lastError?.message}). Using stale cache.`);
          _byCategory = stale.byCategory;
          _categoryIndex = buildCategoryIndex(stale.byCategory);
          return stale.byCategory;
        }
        throw lastError;
      }
    }

    await set(BENCHMARKS_CACHE, { byCategory, fetchedAt: Date.now() });
    _byCategory = byCategory;
    _categoryIndex = buildCategoryIndex(byCategory);
    return byCategory;
  })();

  return await _loadingPromise;
}

export async function getElo(orModelId, { force = false, category = 'overall' } = {}) {
  if (!_categoryIndex || force) await loadLeaderboard({ force });
  const idx = _categoryIndex[category] ?? _categoryIndex.overall;
  if (!idx) return null;
  return match(orModelId, idx);
}

export async function getAllElo({ force = false } = {}) {
  const byCategory = await loadLeaderboard({ force });
  return byCategory; // { overall: entry[], coding: entry[], ... }
}

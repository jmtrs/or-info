import { get, set, TTL } from './cache.mjs';
import { BENCHMARKS_CACHE } from './paths.mjs';
import { VERSION } from './version.mjs';

const HF_ROWS =
  'https://datasets-server.huggingface.co/rows?dataset=lmarena-ai%2Fleaderboard-dataset&config=text&split=latest';
const PAGE = 100;
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

// ── Fetch ──────────────────────────────────────────────────────────────────

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

// Fetch all rows where category === 'overall'.
// The dataset is sorted so 'overall' rows appear first; we stop
// as soon as we see a different category.
async function fetchAllOverall() {
  const entries = [];
  let offset = 0;

  while (true) {
    const page = await fetchPage(offset);
    const rows = page.rows ?? [];
    if (!rows.length) break;

    let sawOther = false;
    for (const { row } of rows) {
      if (row.category !== 'overall') { sawOther = true; break; }
      entries.push({
        lmarenaName: row.model_name,
        elo: Math.round(row.rating),
        eloLower: Math.round(row.rating_lower),
        eloUpper: Math.round(row.rating_upper),
        votes: Math.round(row.vote_count),
        rank: Math.round(row.rank),
        updatedAt: row.leaderboard_publish_date,
      });
    }
    if (sawOther) break;
    offset += PAGE;
    if (offset >= (page.num_rows_total ?? Infinity)) break;
  }
  return entries;
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
// Also index by the last "segment" after the last '-' number group
// to help with partial matches.
function buildIndex(entries) {
  const exact = new Map();
  for (const e of entries) {
    exact.set(normalise(e.lmarenaName), e);
  }
  return exact;
}

// Find the best matching LMArena entry for an OpenRouter model ID.
// Returns the entry or null.
function match(orId, index) {
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

let _index = null;

export async function loadLeaderboard({ force = false } = {}) {
  if (!force) {
    const cached = await get(BENCHMARKS_CACHE, TTL.BENCHMARKS);
    if (cached?.entries) {
      _index = buildIndex(cached.entries);
      return cached.entries;
    }
  }

  const entries = await fetchAllOverall();
  await set(BENCHMARKS_CACHE, { entries, fetchedAt: Date.now() });
  _index = buildIndex(entries);
  return entries;
}

export async function getElo(orModelId, { force = false } = {}) {
  if (!_index || force) await loadLeaderboard({ force });
  return match(orModelId, _index);
}

export async function getAllElo({ force = false } = {}) {
  const entries = await loadLeaderboard({ force });
  return entries; // [{lmarenaName, elo, eloLower, eloUpper, votes, rank, updatedAt}]
}

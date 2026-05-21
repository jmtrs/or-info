import { pricePerMillion, supportsFeature } from './openrouter.mjs';

// ELO range observed on LMArena (2026): ~1050 (weak) to ~1500 (best)
const ELO_MIN = 1050;
const ELO_MAX = 1500;

function normaliseElo(elo) {
  return Math.max(0, Math.min(100, ((elo - ELO_MIN) / (ELO_MAX - ELO_MIN)) * 100));
}

// Returns a penalty factor [0, 1] based on output price.
// Free models → 1.0 (no penalty)
// Very cheap (<$0.5/M) → near 1.0
// Expensive (>$20/M) → significantly penalised
function pricePenalty(outputPerM) {
  if (outputPerM === null || outputPerM === 0) return 1.0;
  // log-scale penalty: $1/M → 0.93, $5/M → 0.83, $20/M → 0.72
  return Math.max(0.1, 1 - Math.log10(outputPerM + 1) * 0.15);
}

function requiresCapability(task) {
  if (task === 'vision') return 'vision';
  if (task === 'coding') return 'tools';
  return null;
}

// Score a model for a task.
// Returns { score, qualityScore } or null if not eligible.
export function scoreForTask(model, eloEntry, task = 'general') {
  const cap = requiresCapability(task);
  if (cap && !supportsFeature(model, cap)) return null;
  if (!eloEntry?.elo) return null;

  const quality = normaliseElo(eloEntry.elo);
  const price = pricePerMillion(model);
  const penalty = task === 'cheap'
    ? pricePenalty(price.output) * 1.4   // aggressively favour cheap
    : pricePenalty(price.output);

  return {
    score: Math.round(quality * penalty * 10) / 10,
    qualityScore: Math.round(quality * 10) / 10,
  };
}

const CATEGORY_FOR_TASK = { coding: 'coding', reasoning: 'math', vision: null };

export function rankModels(models, allElo, { task = 'general', maxPricePerMOutput, limit = 5 } = {}) {
  // allElo may be a by-category map { overall: [...], coding: [...], ... }
  // or a plain array (legacy). Select the right category for this task.
  const category = CATEGORY_FOR_TASK[task] ?? 'overall';
  const entries = Array.isArray(allElo)
    ? allElo
    : (allElo[category] ?? allElo.overall ?? []);

  const scored = [];

  for (const model of models) {
    const eloEntry = entries.find
      ? entries.find((e) => _matchName(e.lmarenaName, model.id))
      : null;

    const result = scoreForTask(model, eloEntry, task);
    if (!result) continue;

    const price = pricePerMillion(model);
    if (maxPricePerMOutput !== undefined && price.output !== null && price.output > maxPricePerMOutput) continue;

    scored.push({ model, score: result.score, qualityScore: result.qualityScore, eloEntry });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

// Inline minimal name matching (mirrors lmarena.mjs logic without importing it)
function _norm(s) {
  return s.toLowerCase().replace(/\./g, '-').replace(/-20\d{2}-?\d{2}-?\d{2,}(-.+)?$/, '').replace(/-{2,}/g, '-');
}

function _matchName(lmarenaName, orId) {
  const lm = _norm(lmarenaName);
  const slug = _norm(orId.includes('/') ? orId.split('/').slice(1).join('/') : orId);
  if (lm === slug) return true;
  if (slug.length >= 8 && slug.includes(lm)) return true;
  if (lm.length >= 8 && lm.includes(slug)) return true;
  return false;
}

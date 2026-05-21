import { pricePerMillion, supportsFeature, contextLength } from './openrouter.mjs';

// ELO range observed on LMArena (2026): ~1000 (weak) to ~1540+ (best)
const ELO_MIN = 1000;
const ELO_MAX = 1600;

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

// Steeper penalty for cheap task — more spread between free and expensive.
// Free → 1.0, $1/M → 0.88, $5/M → 0.72, $20/M → 0.59
function cheapPenalty(outputPerM) {
  if (outputPerM === null || outputPerM === 0) return 1.0;
  return Math.max(0.1, 1 - Math.log10(outputPerM + 1) * 0.25);
}

// Context window bonus [0.9, 1.0]. Larger context is more useful,
// especially for coding where long files are common.
function contextBonus(ctx, task) {
  if (!ctx) return 0.9;
  if (ctx >= 128_000) return 1.0;
  if (ctx >= 64_000) return 0.97;
  if (ctx >= 32_000) return 0.93;
  return 0.9;
}

// Score a model for a task with optional pricing override.
// Returns { score, qualityScore } or null if not eligible.
export function scoreForTask(model, eloEntry, task = 'general', pricing) {
  const { pricingMode, capability } = parseTaskSpec(task, pricing);

  // Hard filter: vision requires vision capability
  if (capability === 'vision' && !supportsFeature(model, 'vision')) return null;
  if (!eloEntry?.elo) return null;

  const quality = normaliseElo(eloEntry.elo);
  const price = pricePerMillion(model);
  const ctx = contextLength(model);

  // Price penalty: premium ignores price, cheap uses steep curve, others standard
  let penalty;
  if (pricingMode === 'premium') {
    penalty = 1.0;
  } else if (pricingMode === 'cheap') {
    penalty = cheapPenalty(price.output);
  } else {
    penalty = pricePenalty(price.output);
  }

  const ctxB = contextBonus(ctx, task);

  // Soft penalty for coding without tools (still eligible, just less ideal)
  const capPenalty = (task === 'coding' && !supportsFeature(model, 'tools')) ? 0.85 : 1.0;

  const rawScore = quality * penalty * ctxB * capPenalty;

  return {
    score: Math.round(Math.min(100, rawScore) * 10) / 10,
    qualityScore: Math.round(quality * 10) / 10,
  };
}

// Parse task into { eloCategory, pricingMode, capability }.
// This decouples the ELO category from the price penalty strategy.
// task='coding' → coding ELO, standard pricing
// task='coding', pricing='premium' → coding ELO, no price penalty
const TASK_ELO = { coding: 'coding', reasoning: 'math', vision: null, general: null, cheap: null, premium: null };
const TASK_CAP = { vision: 'vision', coding: 'tools' };
const PRICING_MODES = new Set(['standard', 'cheap', 'premium']);

function parseTaskSpec(task, pricing) {
  const eloCategory = TASK_ELO[task] ?? 'overall';
  const capability = TASK_CAP[task] ?? null;
  let pricingMode = pricing ?? 'standard';
  // Legacy: 'cheap' and 'premium' as task names set pricing mode
  if (task === 'cheap') pricingMode = 'cheap';
  else if (task === 'premium') pricingMode = 'premium';
  if (!PRICING_MODES.has(pricingMode)) pricingMode = 'standard';
  return { eloCategory, pricingMode, capability };
}

export function rankModels(models, allElo, { task = 'general', pricing, maxPricePerMOutput, limit = 5 } = {}) {
  const { eloCategory } = parseTaskSpec(task, pricing);
  const entries = Array.isArray(allElo)
    ? allElo
    : (allElo[eloCategory] ?? allElo.overall ?? []);

  const scored = [];

  for (const model of models) {
    const eloEntry = entries.find
      ? entries.find((e) => _matchName(e.lmarenaName, model.id))
      : null;

    const result = scoreForTask(model, eloEntry, task, pricing);
    if (!result) continue;

    const price = pricePerMillion(model);
    if (maxPricePerMOutput !== undefined && price.output !== null && price.output > maxPricePerMOutput) continue;

    scored.push({ model, score: result.score, qualityScore: result.qualityScore, eloEntry });
  }

  // Dedup 1: :free variants — keep highest-scoring variant per base model
  const byBase = new Map();
  for (const entry of scored) {
    const baseId = entry.model.id.replace(/:free$/, '');
    const prev = byBase.get(baseId);
    if (!prev || entry.score > prev.score) byBase.set(baseId, entry);
  }

  // Dedup 2: same ELO entry — multiple OR models can match one LMArena name
  // (e.g. gpt-5.4-nano and gpt-5.4 both match "gpt-5.4-high").
  // Keep only the best-scoring OR model per ELO entry.
  const byElo = new Map();
  for (const entry of byBase.values()) {
    const eloKey = entry.eloEntry?.lmarenaName ?? entry.model.id;
    const prev = byElo.get(eloKey);
    if (!prev || entry.score > prev.score) byElo.set(eloKey, entry);
  }

  return [...byElo.values()].sort((a, b) => b.score - a.score).slice(0, limit);
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

import chalk from 'chalk';
import { pricePerMillion, contextLength, maxOutput, modelTags, isFree } from './openrouter.mjs';

const DIM = chalk.dim;
const BOLD = chalk.bold;
const GREEN = chalk.green;
const YELLOW = chalk.yellow;
const CYAN = chalk.cyan;
const RED = chalk.red;
const BLUE = chalk.blue;
const MAGENTA = chalk.magenta;

function fmtPrice(n) {
  if (n === null) return DIM('n/a');
  if (n === 0) return GREEN('free');
  if (n < 0.1) return GREEN(`$${n.toFixed(4)}`);
  if (n < 1) return YELLOW(`$${n.toFixed(4)}`);
  return RED(`$${n.toFixed(4)}`);
}

function maybeFreeWarning(model, price) {
  // OpenRouter sometimes reports pricing="0" for non-free models (e.g. z-ai/glm-5.1).
  // Show a warning so users don't get surprised by charges.
  if (price.input === 0 && price.output === 0 && !model?.id?.endsWith(':free') && model?.id !== 'openrouter/free') {
    return YELLOW('  ⚠ reported free — may incur charges on OpenRouter');
  }
  return null;
}

function fmtCtx(n) {
  if (!n) return DIM('n/a');
  if (n >= 1_000_000) return CYAN(`${(n / 1_000_000).toFixed(1)}M`);
  if (n >= 1_000) return CYAN(`${Math.round(n / 1_000)}k`);
  return CYAN(String(n));
}

function fmtTags(tags) {
  if (!tags.length) return '';
  return tags.map((t) => DIM(`[${t}]`)).join(' ');
}

function pad(s, n, right = false) {
  const str = String(s ?? '');
  // Strip ANSI for length calculation
  const visible = str.replace(/\x1b\[[0-9;]*m/g, '');
  const diff = n - visible.length;
  if (diff <= 0) return str;
  return right ? ' '.repeat(diff) + str : str + ' '.repeat(diff);
}

export function modelTable(models, { showTags = false } = {}) {
  if (!models.length) return DIM('No models found.');

  const rows = models.map((m) => {
    const price = pricePerMillion(m);
    const ctx = contextLength(m);
    const tags = showTags ? modelTags(m) : [];
    const idLabel = maybeFreeWarning(m, price) ? m.id + YELLOW(' ⚠') : m.id;
    return {
      id: idLabel,
      name: m.name ?? m.id,
      input: fmtPrice(price.input),
      output: fmtPrice(price.output),
      ctx: fmtCtx(ctx),
      tags: fmtTags(tags),
    };
  });

  const idW = Math.min(50, Math.max(20, ...rows.map((r) => r.id.length)));
  const nameW = Math.min(30, Math.max(10, ...rows.map((r) => r.name.replace(/\x1b\[[0-9;]*m/g, '').length)));

  const header =
    BOLD(pad('ID', idW)) + '  ' +
    BOLD(pad('In /M', 10, true)) + '  ' +
    BOLD(pad('Out /M', 10, true)) + '  ' +
    BOLD(pad('Context', 8, true));

  const sep = DIM('─'.repeat(idW + 2 + 10 + 2 + 10 + 2 + 8));

  const lines = rows.map((r) => {
    const line =
      pad(r.id, idW) + '  ' +
      pad(r.input, 10, true) + '  ' +
      pad(r.output, 10, true) + '  ' +
      pad(r.ctx, 8, true);
    return r.tags ? line + '  ' + r.tags : line;
  });

  return [header, sep, ...lines].join('\n');
}

export function modelDetail(model, bench = null) {
  const price = pricePerMillion(model);
  const ctx = contextLength(model);
  const maxOut = maxOutput(model);
  const tags = modelTags(model);

  const lines = [
    '',
    BOLD(CYAN(model.name ?? model.id)),
    DIM(model.id),
    '',
    BOLD('Pricing'),
    `  Input   ${fmtPrice(price.input)} per 1M tokens`,
    `  Output  ${fmtPrice(price.output)} per 1M tokens`,
  ];

  const freeWarn = maybeFreeWarning(model, price);
  if (freeWarn) lines.push(freeWarn);

  if (price.image !== null) lines.push(`  Image   ${fmtPrice(price.image)} per 1M tokens`);
  if (price.cacheRead !== null) lines.push(`  Cache↓  ${fmtPrice(price.cacheRead)} per 1M tokens`);
  if (price.cacheWrite !== null) lines.push(`  Cache↑  ${fmtPrice(price.cacheWrite)} per 1M tokens`);

  lines.push('');
  lines.push(BOLD('Capacity'));
  lines.push(`  Context    ${fmtCtx(ctx)}`);
  if (maxOut) lines.push(`  Max output ${fmtCtx(maxOut)}`);

  if (tags.length) {
    lines.push('');
    lines.push(BOLD('Features'));
    lines.push('  ' + tags.map((t) => BLUE(`[${t}]`)).join(' '));
  }

  const arch = model?.architecture;
  if (arch?.modality) {
    lines.push('');
    lines.push(BOLD('Architecture'));
    lines.push(`  ${DIM(arch.modality)}`);
    if (arch.tokenizer) lines.push(`  Tokenizer: ${DIM(arch.tokenizer)}`);
  }

  if (bench) {
    lines.push('');
    lines.push(BOLD('LMArena ELO  ') + DIM('(lmarena.ai — human preference votes)'));
    lines.push(`  ELO    ${YELLOW(String(bench.elo))}  ${DIM(`±${Math.round((bench.eloUpper - bench.eloLower) / 2)}`)}`);
    lines.push(`  Rank   ${YELLOW('#' + bench.rank)}`);
    lines.push(`  Votes  ${DIM(bench.votes.toLocaleString())}`);
    if (bench.updatedAt) lines.push(`  ${DIM('Updated: ' + bench.updatedAt)}`);
  }

  lines.push('');
  return lines.join('\n');
}

export function comparison(modelA, benchA, modelB, benchB, category = 'overall') {
  const render = (model, bench) => modelDetail(model, bench).split('\n');

  const linesA = render(modelA, benchA);
  const linesB = render(modelB, benchB);
  const maxLines = Math.max(linesA.length, linesB.length);
  const colW = 52;

  const result = [BOLD(`── Comparison${category !== 'overall' ? ` (${category} ELO)` : ''} ──`), ''];
  for (let i = 0; i < maxLines; i++) {
    const a = linesA[i] ?? '';
    const b = linesB[i] ?? '';
    const aVis = a.replace(/\x1b\[[0-9;]*m/g, '');
    const padding = Math.max(0, colW - aVis.length);
    result.push(a + ' '.repeat(padding) + DIM('│') + ' ' + b);
  }
  return result.join('\n');
}

export function topList(ranked) {
  if (!ranked.length) return DIM('No results.');

  const lines = [BOLD('── Top Models ──'), ''];
  ranked.forEach(({ model, score, qualityScore, eloEntry }, i) => {
    const price = pricePerMillion(model);
    const medal = i === 0 ? YELLOW('#1') : i === 1 ? DIM('#2') : i === 2 ? DIM('#3') : DIM(`#${i + 1}`);
    const eloStr = eloEntry ? DIM(`ELO ${eloEntry.elo}`) : DIM('no ELO');
    lines.push(`${medal}  ${BOLD(CYAN(model.id))}`);
    lines.push(`    Score ${YELLOW(score.toFixed(1))}  │  Out ${fmtPrice(price.output)}/M  │  ${eloStr}`);
    lines.push('');
  });
  return lines.join('\n');
}

export function statusReport(items) {
  const lines = [BOLD('── Cache Status ──'), ''];
  for (const { key, exists, ageMs, fresh, ttlMs } of items) {
    const indicator = !exists ? RED('✗ missing') : fresh ? GREEN('✓ fresh') : YELLOW('⚠ stale');
    const age = ageMs ? `${Math.round(ageMs / 60_000)}m ago` : '—';
    const ttl = `TTL ${Math.round(ttlMs / 60_000)}m`;
    lines.push(`  ${pad(key, 12)} ${indicator}  ${DIM(age)}  ${DIM(ttl)}`);
  }
  lines.push('');
  return lines.join('\n');
}

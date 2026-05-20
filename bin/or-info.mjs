#!/usr/bin/env node
import { InvalidArgumentError, program } from 'commander';
import chalk from 'chalk';
import { fetchModels, findModel, pricePerMillion, contextLength } from '../lib/openrouter.mjs';
import { getElo, getAllElo, loadLeaderboard } from '../lib/lmarena.mjs';
import { rankModels } from '../lib/scorer.mjs';
import { clearAll, status } from '../lib/cache.mjs';
import { getApiKey } from '../lib/secrets.mjs';
import {
  modelTable,
  modelDetail,
  comparison,
  topList,
  statusReport,
} from '../lib/formatter.mjs';

function die(msg) {
  console.error(chalk.red('Error: ') + msg);
  process.exit(1);
}

const TOP_TASKS = new Set(['coding', 'reasoning', 'general', 'vision', 'cheap']);

function parsePositiveInteger(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1 || String(n) !== String(value).trim()) {
    throw new InvalidArgumentError('must be a positive integer');
  }
  return n;
}

function parseLimit(value, max) {
  return Math.min(max, parsePositiveInteger(value));
}

async function apiKey() {
  return getApiKey();
}

program
  .name('or-info')
  .description('OpenRouter model info: prices, benchmarks, context and comparisons')
  .version('0.1.0')
  .option('--mcp', 'Start MCP server (stdio transport)');

// ── models ─────────────────────────────────────────────────────────────────
program
  .command('models')
  .description('List all models with pricing')
  .option('--sort <field>', 'Sort by: price, context, name', 'name')
  .option('--filter <text>', 'Filter by model ID or name (case-insensitive)')
  .option('--free', 'Show only free models')
  .option('--limit <n>', 'Maximum number of models to return (max 200)', (v) => parseLimit(v, 200))
  .option('--tags', 'Show feature tags')
  .option('--json', 'Output raw JSON')
  .action(async (opts) => {
    const key = await apiKey();
    let models = await fetchModels({ apiKey: key });

    if (opts.filter) {
      const q = opts.filter.toLowerCase();
      models = models.filter(
        (m) => m.id.toLowerCase().includes(q) || (m.name ?? '').toLowerCase().includes(q)
      );
    }
    if (opts.free) {
      models = models.filter((m) => {
        const p = pricePerMillion(m);
        return p.input === 0 && p.output === 0;
      });
    }

    if (opts.sort === 'price') {
      models.sort((a, b) => {
        const pa = pricePerMillion(a).output ?? Infinity;
        const pb = pricePerMillion(b).output ?? Infinity;
        return pa - pb;
      });
    } else if (opts.sort === 'context') {
      models.sort((a, b) => (contextLength(b) ?? 0) - (contextLength(a) ?? 0));
    } else {
      models.sort((a, b) => a.id.localeCompare(b.id));
    }

    if (opts.limit) models = models.slice(0, opts.limit);

    if (opts.json) {
      console.log(JSON.stringify(models, null, 2));
      return;
    }
    console.log(modelTable(models, { showTags: opts.tags }));
    console.log(chalk.dim(`  ${models.length} models`));
  });

// ── price ──────────────────────────────────────────────────────────────────
program
  .command('price <model-id>')
  .description('Detailed pricing and context for a model')
  .option('--json', 'Output raw JSON')
  .action(async (modelId, opts) => {
    const key = await apiKey();
    const models = await fetchModels({ apiKey: key });
    const model = findModel(models, modelId);
    if (!model) die(`Model not found: ${modelId}`);

    if (opts.json) {
      console.log(JSON.stringify({
        model: model.id,
        pricing: model.pricing,
        context_length: contextLength(model),
      }, null, 2));
      return;
    }
    const elo = await getElo(modelId);
    console.log(modelDetail(model, elo));
  });

// ── benchmark ──────────────────────────────────────────────────────────────
program
  .command('benchmark <model-id>')
  .description('LMArena ELO and pricing details for a model')
  .option('--json', 'Output raw JSON')
  .action(async (modelId, opts) => {
    const [key, elo] = await Promise.all([apiKey(), getElo(modelId)]);
    if (opts.json) {
      console.log(JSON.stringify({ model: modelId, elo: elo ?? null }, null, 2));
      return;
    }
    const models = await fetchModels({ apiKey: key });
    const model = findModel(models, modelId);
    if (!model) die(`Model not found: ${modelId}`);
    if (!elo) {
      console.log(modelDetail(model, null));
      console.log(chalk.yellow('  No LMArena ELO data for this model.'));
      console.log(chalk.dim('  Data refreshes every 24h from lmarena.ai via HuggingFace.'));
      return;
    }
    console.log(modelDetail(model, elo));
  });

// ── compare ────────────────────────────────────────────────────────────────
program
  .command('compare <model-a> <model-b>')
  .description('Side-by-side comparison of two models')
  .option('--json', 'Output raw JSON')
  .action(async (idA, idB, opts) => {
    const key = await apiKey();
    const [models, eloA, eloB] = await Promise.all([
      fetchModels({ apiKey: key }),
      getElo(idA),
      getElo(idB),
    ]);
    const mA = findModel(models, idA);
    const mB = findModel(models, idB);
    if (!mA) die(`Model not found: ${idA}`);
    if (!mB) die(`Model not found: ${idB}`);

    if (opts.json) {
      console.log(JSON.stringify({ a: { model: mA, elo: eloA }, b: { model: mB, elo: eloB } }, null, 2));
      return;
    }
    console.log(comparison(mA, eloA, mB, eloB));
  });

// ── top ────────────────────────────────────────────────────────────────────
program
  .command('top')
  .description('Best models for a task')
  .option('--task <task>', 'Task: coding, reasoning, general, vision, cheap', 'general')
  .option('--budget <usd>', 'Max price per 1M output tokens (e.g. 1.00)', parseFloat)
  .option('--limit <n>', 'Number of results', parsePositiveInteger, 5)
  .option('--json', 'Output raw JSON')
  .action(async (opts) => {
    if (!TOP_TASKS.has(opts.task)) {
      die(`Invalid task: ${opts.task}. Expected one of: ${[...TOP_TASKS].join(', ')}`);
    }

    const key = await apiKey();
    const [models, allElo] = await Promise.all([
      fetchModels({ apiKey: key }),
      getAllElo(),
    ]);

    const ranked = rankModels(models, allElo, {
      task: opts.task,
      maxPricePerMOutput: opts.budget,
      limit: opts.limit,
    });

    if (!ranked.length) {
      console.log(chalk.yellow('No results. Try a different task or increase --budget.'));
      return;
    }
    if (opts.json) {
      console.log(JSON.stringify(ranked.map((r) => ({ id: r.model.id, score: r.score, elo: r.eloEntry }))));
      return;
    }
    console.log(topList(ranked));
  });

// ── refresh ────────────────────────────────────────────────────────────────
program
  .command('refresh')
  .description('Force-refresh the cache (models + LMArena ELO)')
  .action(async () => {
    const key = await apiKey();
    process.stdout.write(chalk.dim('Refreshing models…'));
    const models = await fetchModels({ apiKey: key, force: true });
    process.stdout.write(chalk.green(` ✓  ${models.length} models\n`));

    process.stdout.write(chalk.dim('Refreshing LMArena ELO…'));
    const elo = await loadLeaderboard({ force: true });
    console.log(chalk.green(` ✓  ${elo.length} entries`));
  });

// ── status ─────────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show cache status')
  .action(async () => {
    const items = await status();
    console.log(statusReport(items));
  });

// ── root --mcp ─────────────────────────────────────────────────────────────
// Must be checked before parseAsync: Commander exits (shows help, code 1)
// when no subcommand is given, so the --mcp branch would never be reached.
if (process.argv.includes('--mcp')) {
  const { startMcp } = await import('../mcp/server.mjs');
  await startMcp();
  process.exit(0);
}

program.hook('preAction', async () => {});

program.parseAsync(process.argv).catch((err) => {
  // Avoid leaking API keys or file paths from raw errors
  const safe = err.message?.replace(/sk-[a-zA-Z0-9-]+/g, '[REDACTED]');
  die(safe ?? 'Unexpected error');
});

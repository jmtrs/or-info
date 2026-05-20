import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { fetchModels, findModel, pricePerMillion, contextLength, modelTags } from '../lib/openrouter.mjs';
import { getElo, getAllElo, loadLeaderboard } from '../lib/lmarena.mjs';
import { rankModels } from '../lib/scorer.mjs';
import { getApiKey } from '../lib/secrets.mjs';

const TOOLS = [
  {
    name: 'get_model_info',
    description: 'Get pricing, context length, architecture and features for a specific OpenRouter model',
    inputSchema: {
      type: 'object',
      properties: {
        model_id: { type: 'string', description: 'OpenRouter model ID, e.g. "anthropic/claude-sonnet-4-5"' },
      },
      required: ['model_id'],
    },
  },
  {
    name: 'list_models',
    description: 'List OpenRouter models with pricing. Optionally filter by name/id, sort, and limit results.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Case-insensitive substring to match against model ID or name' },
        sort_by: { type: 'string', enum: ['name', 'price', 'context'], description: 'Sort order', default: 'name' },
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Max models to return (default 50)' },
        free_only: { type: 'boolean', description: 'Return only free models' },
      },
    },
  },
  {
    name: 'get_benchmarks',
    description: 'Get benchmark scores for a model: MMLU, HumanEval, MATH, coding, ELO, speed and latency',
    inputSchema: {
      type: 'object',
      properties: {
        model_id: { type: 'string', description: 'OpenRouter model ID' },
      },
      required: ['model_id'],
    },
  },
  {
    name: 'compare_models',
    description: 'Side-by-side comparison of two models: pricing, context, benchmarks and features',
    inputSchema: {
      type: 'object',
      properties: {
        model_a: { type: 'string', description: 'First OpenRouter model ID' },
        model_b: { type: 'string', description: 'Second OpenRouter model ID' },
      },
      required: ['model_a', 'model_b'],
    },
  },
  {
    name: 'best_for_task',
    description: 'Rank the best models for a specific task, optionally within a price budget',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          enum: ['coding', 'reasoning', 'general', 'vision', 'cheap'],
          description: 'Task type to optimise for',
        },
        max_price_per_m_output: {
          type: 'number',
          description: 'Maximum price per 1M output tokens in USD (e.g. 1.0)',
        },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Number of results (default 5)' },
      },
      required: ['task'],
    },
  },
  {
    name: 'refresh_cache',
    description: 'Force-refresh the local cache: OpenRouter model catalog + LMArena ELO data',
    inputSchema: { type: 'object', properties: {} },
  },
];

function safeModelSummary(model) {
  const price = pricePerMillion(model);
  return {
    id: model.id,
    name: model.name,
    input_per_m: price.input,
    output_per_m: price.output,
    image_per_m: price.image,
    cache_read_per_m: price.cacheRead,
    context_length: contextLength(model),
    features: modelTags(model),
    modality: model?.architecture?.modality ?? null,
    tokenizer: model?.architecture?.tokenizer ?? null,
    max_output_tokens: model?.top_provider?.max_completion_tokens ?? null,
    supported_parameters: model?.supported_parameters ?? [],
  };
}

function textContent(obj) {
  return [{ type: 'text', text: JSON.stringify(obj, null, 2) }];
}

function errorContent(msg) {
  return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
}

async function handleTool(name, args) {
  const key = await getApiKey();

  if (name === 'get_model_info') {
    const { model_id } = args;
    if (!model_id || typeof model_id !== 'string') return errorContent('model_id is required');
    const models = await fetchModels({ apiKey: key });
    const model = findModel(models, model_id);
    if (!model) return errorContent(`Model not found: ${model_id}`);
    const elo = await getElo(model_id);
    return { content: textContent({ ...safeModelSummary(model), lmarena_elo: elo ?? null }) };
  }

  if (name === 'list_models') {
    const filter = String(args.filter ?? '').toLowerCase();
    const sortBy = args.sort_by ?? 'name';
    const limit = Math.min(200, Math.max(1, args.limit ?? 50));
    const freeOnly = Boolean(args.free_only);

    let models = await fetchModels({ apiKey: key });
    if (filter) models = models.filter((m) => m.id.toLowerCase().includes(filter) || (m.name ?? '').toLowerCase().includes(filter));
    if (freeOnly) models = models.filter((m) => { const p = pricePerMillion(m); return p.input === 0 && p.output === 0; });

    if (sortBy === 'price') models.sort((a, b) => (pricePerMillion(a).output ?? Infinity) - (pricePerMillion(b).output ?? Infinity));
    else if (sortBy === 'context') models.sort((a, b) => (contextLength(b) ?? 0) - (contextLength(a) ?? 0));
    else models.sort((a, b) => a.id.localeCompare(b.id));

    models = models.slice(0, limit);
    return { content: textContent({ total: models.length, models: models.map(safeModelSummary) }) };
  }

  if (name === 'get_benchmarks') {
    const { model_id } = args;
    if (!model_id || typeof model_id !== 'string') return errorContent('model_id is required');
    const elo = await getElo(model_id);
    return { content: textContent({ model_id, lmarena_elo: elo ?? null }) };
  }

  if (name === 'compare_models') {
    const { model_a, model_b } = args;
    if (!model_a || !model_b) return errorContent('model_a and model_b are required');
    const [models, eloA, eloB] = await Promise.all([
      fetchModels({ apiKey: key }),
      getElo(model_a),
      getElo(model_b),
    ]);
    const mA = findModel(models, model_a);
    const mB = findModel(models, model_b);
    if (!mA) return errorContent(`Model not found: ${model_a}`);
    if (!mB) return errorContent(`Model not found: ${model_b}`);
    return { content: textContent({ a: { ...safeModelSummary(mA), lmarena_elo: eloA }, b: { ...safeModelSummary(mB), lmarena_elo: eloB } }) };
  }

  if (name === 'best_for_task') {
    const task = args.task ?? 'general';
    const limit = Math.min(20, Math.max(1, args.limit ?? 5));
    const maxPrice = args.max_price_per_m_output ?? undefined;

    const [models, allElo] = await Promise.all([fetchModels({ apiKey: key }), getAllElo()]);
    const ranked = rankModels(models, allElo, { task, maxPricePerMOutput: maxPrice, limit });
    return { content: textContent({ task, results: ranked.map((r) => ({ ...safeModelSummary(r.model), score: r.score, lmarena_elo: r.eloEntry })) }) };
  }

  if (name === 'refresh_cache') {
    const [models, elo] = await Promise.all([
      fetchModels({ force: true, apiKey: key }),
      loadLeaderboard({ force: true }),
    ]);
    return { content: textContent({ refreshed: true, models_count: models.length, elo_entries: elo.length }) };
  }

  return errorContent(`Unknown tool: ${name}`);
}

export async function startMcp() {
  const server = new Server(
    { name: 'or-info', version: '0.1.3' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      return await handleTool(name, args ?? {});
    } catch (err) {
      const safe = err.message?.replace(/sk-[a-zA-Z0-9-]+/g, '[REDACTED]') ?? 'Unexpected error';
      return errorContent(safe);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // server.connect() returns immediately after wiring up the transport.
  // Block here until stdin closes so the process stays alive while serving.
  if (!process.stdin.destroyed) {
    await new Promise((resolve) => {
      process.stdin.once('close', resolve);
      process.stdin.once('end', resolve);
    });
  }
}

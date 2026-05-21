import { createRequire } from 'node:module';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { fetchModels, findModel, pricePerMillion, contextLength, modelTags, isFree } from '../lib/openrouter.mjs';
import { getElo, getAllElo, loadLeaderboard } from '../lib/lmarena.mjs';
import { rankModels } from '../lib/scorer.mjs';
import { getApiKey } from '../lib/secrets.mjs';

const { version } = createRequire(import.meta.url)('../package.json');

const MODEL_SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    input_per_m: { type: ['number', 'null'], description: 'Input price per 1M tokens (USD)' },
    output_per_m: { type: ['number', 'null'], description: 'Output price per 1M tokens (USD)' },
    image_per_m: { type: ['number', 'null'] },
    cache_read_per_m: { type: ['number', 'null'] },
    context_length: { type: ['integer', 'null'] },
    features: { type: 'array', items: { type: 'string' } },
    modality: { type: ['string', 'null'] },
    tokenizer: { type: ['string', 'null'] },
    max_output_tokens: { type: ['integer', 'null'] },
    supported_parameters: { type: 'array', items: { type: 'string' } },
  },
};

const ELO_SCHEMA = { type: ['object', 'null'], description: 'LMArena ELO entry or null when not tracked' };

const TOOL_ALIASES = {
  get_model_info: 'models.get',
  list_models: 'models.list',
  compare_models: 'models.compare',
  best_for_task: 'models.top',
  get_benchmarks: 'benchmarks.get',
  refresh_cache: 'cache.refresh',
};

const CANONICAL_TOOLS = [
  {
    name: 'models.get',
    description: 'Get pricing, context length, architecture and features for a specific OpenRouter model',
    inputSchema: {
      type: 'object',
      properties: {
        model_id: { type: 'string', description: 'OpenRouter model ID, e.g. "anthropic/claude-sonnet-4-5"' },
      },
      required: ['model_id'],
    },
    outputSchema: {
      type: 'object',
      properties: { ...MODEL_SUMMARY_SCHEMA.properties, lmarena_elo: ELO_SCHEMA },
    },
    annotations: {
      title: 'Get model',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'models.list',
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
    outputSchema: {
      type: 'object',
      properties: {
        total: { type: 'integer' },
        models: { type: 'array', items: MODEL_SUMMARY_SCHEMA },
      },
      required: ['total', 'models'],
    },
    annotations: {
      title: 'List models',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'benchmarks.get',
    description: 'Get LMArena ELO ranking for a model: score, global rank, vote count and confidence interval',
    inputSchema: {
      type: 'object',
      properties: {
        model_id: { type: 'string', description: 'OpenRouter model ID' },
      },
      required: ['model_id'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        model_id: { type: 'string' },
        lmarena_elo: ELO_SCHEMA,
      },
      required: ['model_id'],
    },
    annotations: {
      title: 'Get benchmark',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'models.compare',
    description: 'Side-by-side comparison of two models: pricing, context, benchmarks and features',
    inputSchema: {
      type: 'object',
      properties: {
        model_a: { type: 'string', description: 'First OpenRouter model ID' },
        model_b: { type: 'string', description: 'Second OpenRouter model ID' },
      },
      required: ['model_a', 'model_b'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        a: { type: 'object', properties: { ...MODEL_SUMMARY_SCHEMA.properties, lmarena_elo: ELO_SCHEMA } },
        b: { type: 'object', properties: { ...MODEL_SUMMARY_SCHEMA.properties, lmarena_elo: ELO_SCHEMA } },
      },
      required: ['a', 'b'],
    },
    annotations: {
      title: 'Compare models',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'models.top',
    description: 'Rank the best models for a specific task, optionally within a price budget',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          enum: ['coding', 'reasoning', 'general', 'vision', 'cheap', 'premium'],
          description: 'Task type to optimise for',
        },
        pricing: {
          type: 'string',
          enum: ['standard', 'cheap', 'premium'],
          description: 'Price scoring override. Set to "premium" with task="coding" for best coding model regardless of price',
        },
        max_price_per_m_output: {
          type: 'number',
          description: 'Maximum price per 1M output tokens in USD (e.g. 1.0)',
        },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Number of results (default 5)' },
      },
      required: ['task'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string' },
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: { ...MODEL_SUMMARY_SCHEMA.properties, score: { type: 'number' }, lmarena_elo: ELO_SCHEMA },
          },
        },
      },
      required: ['task', 'results'],
    },
    annotations: {
      title: 'Top models for task',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'cache.refresh',
    description: 'Force-refresh the local cache: OpenRouter model catalog + LMArena ELO data',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: {
      type: 'object',
      properties: {
        refreshed: { type: 'boolean' },
        models_count: { type: 'integer' },
        elo_entries: { type: 'integer' },
      },
      required: ['refreshed', 'models_count', 'elo_entries'],
    },
    annotations: {
      title: 'Refresh cache',
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
];

// Legacy flat names kept advertised in tools/list for discoverability,
// derived from the canonical tools so input/output schemas stay in sync.
const LEGACY_BY_CANONICAL = Object.fromEntries(
  Object.entries(TOOL_ALIASES).map(([legacy, canonical]) => [canonical, legacy])
);

const LEGACY_TOOLS = CANONICAL_TOOLS.flatMap((tool) => {
  const legacyName = LEGACY_BY_CANONICAL[tool.name];
  if (!legacyName) return [];
  return [{
    ...tool,
    name: legacyName,
    description: `[Deprecated] Alias of \`${tool.name}\`. Use \`${tool.name}\` instead.`,
    annotations: { ...tool.annotations, title: `[Deprecated] ${tool.annotations.title}` },
  }];
});

const TOOLS = [...CANONICAL_TOOLS, ...LEGACY_TOOLS];

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

function result(obj) {
  return {
    content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }],
    structuredContent: obj,
  };
}

function errorContent(msg) {
  return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
}

async function safeGetElo(modelId, opts) {
  try {
    return await getElo(modelId, opts);
  } catch {
    return null;
  }
}

async function safeGetAllElo(opts) {
  try {
    return await getAllElo(opts);
  } catch {
    return {};
  }
}

async function handleTool(name, args) {
  // Accept legacy flat names (get_model_info, list_models, ...) by mapping
  // them to the dot-notation canonical names exposed in tools/list.
  name = TOOL_ALIASES[name] ?? name;
  const key = await getApiKey();

  if (name === 'models.get') {
    const { model_id } = args;
    if (!model_id || typeof model_id !== 'string') return errorContent('model_id is required');
    const models = await fetchModels({ apiKey: key });
    const model = findModel(models, model_id);
    if (!model) return errorContent(`Model not found: ${model_id}`);
    const elo = await safeGetElo(model_id);
    return result({ ...safeModelSummary(model), lmarena_elo: elo ?? null });
  }

  if (name === 'models.list') {
    const filter = String(args.filter ?? '').toLowerCase();
    const sortBy = args.sort_by ?? 'name';
    const limit = Math.min(200, Math.max(1, args.limit ?? 50));
    const freeOnly = Boolean(args.free_only);

    let models = await fetchModels({ apiKey: key });
    if (filter) models = models.filter((m) => m.id.toLowerCase().includes(filter) || (m.name ?? '').toLowerCase().includes(filter));
    if (freeOnly) models = models.filter(isFree);

    if (sortBy === 'price') models.sort((a, b) => (pricePerMillion(a).output ?? Infinity) - (pricePerMillion(b).output ?? Infinity));
    else if (sortBy === 'context') models.sort((a, b) => (contextLength(b) ?? 0) - (contextLength(a) ?? 0));
    else models.sort((a, b) => a.id.localeCompare(b.id));

    models = models.slice(0, limit);
    return result({ total: models.length, models: models.map(safeModelSummary) });
  }

  if (name === 'benchmarks.get') {
    const { model_id } = args;
    if (!model_id || typeof model_id !== 'string') return errorContent('model_id is required');
    const elo = await safeGetElo(model_id);
    return result({ model_id, lmarena_elo: elo ?? null });
  }

  if (name === 'models.compare') {
    const { model_a, model_b } = args;
    if (!model_a || !model_b) return errorContent('model_a and model_b are required');
    const [models, eloA, eloB] = await Promise.all([
      fetchModels({ apiKey: key }),
      safeGetElo(model_a),
      safeGetElo(model_b),
    ]);
    const mA = findModel(models, model_a);
    const mB = findModel(models, model_b);
    if (!mA) return errorContent(`Model not found: ${model_a}`);
    if (!mB) return errorContent(`Model not found: ${model_b}`);
    return result({ a: { ...safeModelSummary(mA), lmarena_elo: eloA }, b: { ...safeModelSummary(mB), lmarena_elo: eloB } });
  }

  if (name === 'models.top') {
    const task = args.task ?? 'general';
    const pricing = args.pricing ?? undefined;
    const limit = Math.min(20, Math.max(1, args.limit ?? 5));
    const maxPrice = args.max_price_per_m_output ?? undefined;

    const [models, allElo] = await Promise.all([fetchModels({ apiKey: key }), safeGetAllElo()]);
    const ranked = rankModels(models, allElo, { task, pricing, maxPricePerMOutput: maxPrice, limit });
    return result({ task, results: ranked.map((r) => ({ ...safeModelSummary(r.model), score: r.score, lmarena_elo: r.eloEntry })) });
  }

  if (name === 'cache.refresh') {
    const [models, elo] = await Promise.all([
      fetchModels({ force: true, apiKey: key }),
      loadLeaderboard({ force: true }),
    ]);
    return result({ refreshed: true, models_count: models.length, elo_entries: (elo.overall ?? []).length });
  }

  return errorContent(`Unknown tool: ${name}`);
}

function makeServer() {
  return new Server(
    { name: 'or-info', version },
    { capabilities: { tools: {} } }
  );
}

function wireHandlers(server) {
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
}

export async function startMcp() {
  // Track in-flight tool calls so we don't exit while a response is still being written.
  // Race condition: stdin EOF fires before the async handleTool completes, causing
  // process.exit(0) to kill the process before the MCP SDK writes the response to stdout.
  let pending = 0;
  let stdinEnded = false;
  let resolveWhenDone;
  const donePromise = new Promise((res) => { resolveWhenDone = res; });

  function checkDone() {
    if (stdinEnded && pending === 0) resolveWhenDone();
  }

  const server = makeServer();
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    pending++;
    try {
      return await handleTool(name, args ?? {});
    } catch (err) {
      const safe = err.message?.replace(/sk-[a-zA-Z0-9-]+/g, '[REDACTED]') ?? 'Unexpected error';
      return errorContent(safe);
    } finally {
      pending--;
      // Defer checkDone by one tick so the SDK's response-write microtask runs first.
      setImmediate(checkDone);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  if (!process.stdin.destroyed) {
    process.stdin.once('close', () => { stdinEnded = true; checkDone(); });
    process.stdin.once('end', () => { stdinEnded = true; checkDone(); });
    await donePromise;
  }
  // One extra tick for any buffered stdout writes before the caller calls process.exit().
  await new Promise((resolve) => setImmediate(resolve));
}

export async function startHttpMcp() {
  const { createServer } = await import('node:http');
  const port = Number(process.env.PORT) || 8000;

  // Bridge config values Smithery may inject from smithery.yaml configSchema.
  // Smithery passes schema properties as-is or uppercased depending on version.
  if (!process.env.OPENROUTER_API_KEY) {
    process.env.OPENROUTER_API_KEY = process.env.api_key ?? process.env.API_KEY ?? '';
  }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = makeServer();
  wireHandlers(server);
  await server.connect(transport);

  const serverCard = JSON.stringify({
    serverInfo: { name: 'or-info', version },
    tools: CANONICAL_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  });

  createServer(async (req, res) => {
    if (req.url?.startsWith('/mcp')) {
      await transport.handleRequest(req, res);
    } else if (req.method === 'GET' && req.url === '/.well-known/mcp/server-card.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(serverCard);
    } else {
      res.writeHead(404);
      res.end();
    }
  }).listen(port, () => {
    process.stderr.write(`or-info HTTP MCP listening on port ${port}\n`);
  });
}

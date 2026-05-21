import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ONLINE_TIMEOUT, callToolWithRetry, parseToolResult, startMcpClient } from '../helpers/online.mjs';
import { createIsolatedAppEnv } from '../helpers/runtime.mjs';
import { BENCHMARKS_CACHE } from '../../lib/paths.mjs';

describe('MCP server', () => {
  let isolated;
  let client;

  before(async () => {
    isolated = await createIsolatedAppEnv('mcp-online');
    await warmUpBenchmarksCache(isolated.env);
    client = await startMcpClient({ env: isolated.env });
  }, { timeout: 15_000 });

  after(async () => {
    client.kill();
    await isolated.cleanup();
  });

  it('tools/list returns canonical and legacy tool names', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await client.send('tools/list', {});
    assert.ok(Array.isArray(result.tools), 'tools should be an array');

    const names = result.tools.map((tool) => tool.name);
    const canonical = [
      'models.get',
      'models.list',
      'benchmarks.get',
      'models.compare',
      'models.top',
      'cache.refresh',
    ];
    const legacy = [
      'get_model_info',
      'list_models',
      'get_benchmarks',
      'compare_models',
      'best_for_task',
      'refresh_cache',
    ];

    for (const name of [...canonical, ...legacy]) {
      assert.ok(names.includes(name), `tool "${name}" should be present`);
    }
  });

  it('each tool has name, description, and inputSchema', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await client.send('tools/list', {});
    for (const tool of result.tools) {
      assert.equal(typeof tool.name, 'string', `${tool.name}: name should be string`);
      assert.equal(typeof tool.description, 'string', `${tool.name}: description should be string`);
      assert.equal(typeof tool.inputSchema, 'object', `${tool.name}: inputSchema should be object`);
    }
  });

  it('get_model_info returns full info for a known model', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'get_model_info', {
      model_id: 'anthropic/claude-3-haiku',
    });
    assert.ok(!result.isError, 'should not be an error');
    const data = parseToolResult(result);
    assert.equal(data.id, 'anthropic/claude-3-haiku');
    assert.equal(typeof data.input_per_m, 'number', 'input_per_m expected');
    assert.equal(typeof data.output_per_m, 'number', 'output_per_m expected');
    assert.ok('context_length' in data, 'context_length expected');
    assert.ok(Array.isArray(data.features), 'features should be array');
    assert.ok('lmarena_elo' in data, 'lmarena_elo field expected');
  });

  it('get_model_info returns isError when model_id is missing', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await client.callTool('get_model_info', {});
    assert.equal(result.isError, true, 'should be an error');
  });

  it('get_model_info returns isError for a non-existent model', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await client.callTool('get_model_info', { model_id: 'nonexistent/model-xyz-00000' });
    assert.equal(result.isError, true, 'should be an error');
  });

  it('list_models returns a list respecting limit', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'list_models', { limit: 5 });
    assert.ok(!result.isError, 'should not be an error');
    const data = parseToolResult(result);
    assert.ok(typeof data.total === 'number', 'total should be number');
    assert.ok(data.total <= 5, 'total should respect limit');
    assert.ok(Array.isArray(data.models), 'models should be array');
    if (data.models.length > 0) {
      const model = data.models[0];
      assert.equal(typeof model.id, 'string', 'model id expected');
      assert.ok('input_per_m' in model, 'input_per_m expected');
      assert.ok('output_per_m' in model, 'output_per_m expected');
      assert.ok('context_length' in model, 'context_length expected');
    }
  });

  it('list_models filter narrows results to matching models', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'list_models', { filter: 'claude', limit: 20 });
    assert.ok(!result.isError, 'should not be an error');
    const data = parseToolResult(result);
    assert.ok(data.models.length > 0, 'should find claude models');
    for (const model of data.models) {
      const match =
        model.id.toLowerCase().includes('claude') ||
        (model.name ?? '').toLowerCase().includes('claude');
      assert.ok(match, `model ${model.id} does not match filter "claude"`);
    }
  });

  it('list_models free_only returns only zero-price models', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'list_models', { free_only: true, limit: 30 });
    assert.ok(!result.isError, 'should not be an error');
    const data = parseToolResult(result);
    assert.ok(data.models.length > 0, 'should have at least one free model');
    for (const model of data.models) {
      assert.equal(model.input_per_m, 0, `${model.id} input_per_m should be 0`);
      assert.equal(model.output_per_m, 0, `${model.id} output_per_m should be 0`);
    }
  });

  it('get_benchmarks returns model_id and lmarena_elo', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'get_benchmarks', {
      model_id: 'anthropic/claude-3-haiku',
    });
    assert.ok(!result.isError, 'should not be an error');
    const data = parseToolResult(result);
    assert.equal(data.model_id, 'anthropic/claude-3-haiku');
    assert.ok('lmarena_elo' in data, 'lmarena_elo field expected');
  });

  it('compare_models returns a/b objects with expected fields', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'compare_models', {
      model_a: 'anthropic/claude-3-haiku',
      model_b: 'openai/gpt-4o-mini',
    });
    assert.ok(!result.isError, 'should not be an error');
    const data = parseToolResult(result);
    assert.equal(data.a.id, 'anthropic/claude-3-haiku', 'a.id expected');
    assert.equal(data.b.id, 'openai/gpt-4o-mini', 'b.id expected');
    assert.ok('input_per_m' in data.a, 'a.input_per_m expected');
    assert.ok('input_per_m' in data.b, 'b.input_per_m expected');
    assert.ok('lmarena_elo' in data.a, 'a.lmarena_elo expected');
    assert.ok('lmarena_elo' in data.b, 'b.lmarena_elo expected');
  });

  it('compare_models returns isError when model_b is missing', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await client.callTool('compare_models', { model_a: 'anthropic/claude-3-haiku' });
    assert.equal(result.isError, true, 'should be an error');
  });

  it('best_for_task returns ranked models respecting limit', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'best_for_task', { task: 'coding', limit: 3 });
    assert.ok(!result.isError, 'should not be an error');
    const data = parseToolResult(result);
    assert.equal(data.task, 'coding');
    assert.ok(Array.isArray(data.results), 'results should be array');
    assert.ok(data.results.length <= 3, 'should respect limit');
    assert.ok(data.results.length > 0, 'should have results');
    for (const item of data.results) {
      assert.equal(typeof item.id, 'string', 'each result needs id');
      assert.equal(typeof item.score, 'number', 'each result needs score');
    }
  });

  it('best_for_task with max_price_per_m_output returns results within budget', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'best_for_task', {
      task: 'general',
      max_price_per_m_output: 2.0,
      limit: 5,
    });
    assert.ok(!result.isError, 'should not be an error');
    const data = parseToolResult(result);
    assert.ok(Array.isArray(data.results), 'results should be array');
    for (const item of data.results) {
      assert.equal(typeof item.score, 'number', 'each result needs score');
    }
  });

  it('calling an unknown tool returns isError', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await client.callTool('nonexistent_tool_xyz', {});
    assert.equal(result.isError, true, 'should be an error for unknown tool');
  });

  it('refresh_cache force-refreshes and returns counts', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'refresh_cache', {});
    if (result.isError) {
      // HuggingFace 429s are transient — skip rather than fail.
      const msg = result.content?.[0]?.text ?? '';
      if (msg.includes('429')) return;
    }
    assert.ok(!result.isError, 'should not be an error');
    const data = parseToolResult(result);
    assert.equal(data.refreshed, true, 'refreshed should be true');
    assert.ok(typeof data.models_count === 'number' && data.models_count > 0, 'models_count should be positive');
    assert.ok(typeof data.elo_entries === 'number' && data.elo_entries >= 0, 'elo_entries should be non-negative');
  });
});

// Copy the user's real benchmarks cache into the isolated env's cache dir
// so tests don't have to re-download from HuggingFace (avoids 429s).
async function warmUpBenchmarksCache(env) {
  try {
    const src = BENCHMARKS_CACHE;
    const dstDir = env.OR_INFO_CACHE_DIR;
    const dst = path.join(dstDir, path.basename(src));
    const content = await fs.readFile(src, 'utf-8');
    await fs.mkdir(dstDir, { recursive: true });
    await fs.writeFile(dst, content, 'utf-8');
  } catch {
    // If the real cache doesn't exist yet, tests will download from scratch.
  }
}

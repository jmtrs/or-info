/**
 * Edge-case MCP tests: unusual model IDs, boundary inputs, rare scenarios.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ONLINE_TIMEOUT, callToolWithRetry, parseToolResult, startMcpClient } from '../helpers/online.mjs';
import { createIsolatedAppEnv } from '../helpers/runtime.mjs';

describe('MCP edge cases', () => {
  let isolated;
  let client;

  before(async () => {
    isolated = await createIsolatedAppEnv('mcp-edge');
    client = await startMcpClient({ env: isolated.env });
  }, { timeout: 15_000 });

  after(async () => {
    client.kill();
    await isolated.cleanup();
  });

  it('get_model_info for model with :free suffix (deepseek/deepseek-v4-flash:free)', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'get_model_info', { model_id: 'deepseek/deepseek-v4-flash:free' });
    assert.ok(!result.isError);
    const data = parseToolResult(result);
    assert.equal(data.id, 'deepseek/deepseek-v4-flash:free');
    assert.equal(data.input_per_m, 0, 'free model: input should be 0');
    assert.equal(data.output_per_m, 0, 'free model: output should be 0');
    assert.ok(data.context_length >= 1_000_000, `context_length ${data.context_length} should be >= 1M`);
  });

  it('get_model_info for alias model with ~ prefix (~anthropic/claude-sonnet-latest)', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'get_model_info', { model_id: '~anthropic/claude-sonnet-latest' });
    assert.ok(!result.isError);
    const data = parseToolResult(result);
    assert.equal(data.id, '~anthropic/claude-sonnet-latest');
    assert.ok(data.input_per_m > 0, 'alias model should have nonzero price');
  });

  it('get_model_info for ultra-cheap model (amazon/nova-micro-v1)', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'get_model_info', { model_id: 'amazon/nova-micro-v1' });
    assert.ok(!result.isError);
    const data = parseToolResult(result);
    assert.ok(data.output_per_m < 1, `output $${data.output_per_m}/M should be under $1`);
    assert.ok(data.output_per_m > 0, 'should not be free');
    assert.equal(data.context_length, 128000);
  });

  it('get_model_info for ultra-expensive model (openai/o1-pro)', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'get_model_info', { model_id: 'openai/o1-pro' });
    assert.ok(!result.isError);
    const data = parseToolResult(result);
    assert.ok(data.output_per_m >= 100, `o1-pro output $${data.output_per_m}/M should be >= $100`);
  });

  it('get_model_info for model with hyphenated provider (anthracite-org/magnum-v4-72b)', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'get_model_info', { model_id: 'anthracite-org/magnum-v4-72b' });
    assert.ok(!result.isError);
    const data = parseToolResult(result);
    assert.equal(data.id, 'anthracite-org/magnum-v4-72b');
  });

  it('get_model_info for tiny-context solidity model (4096 tokens)', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'get_model_info', {
      model_id: 'alfredpros/codellama-7b-instruct-solidity',
    });
    assert.ok(!result.isError);
    const data = parseToolResult(result);
    assert.equal(data.context_length, 4096);
  });

  it('get_model_info with numeric model_id type returns isError', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await client.callTool('get_model_info', { model_id: 42 });
    assert.equal(result.isError, true, 'numeric model_id should be rejected');
  });

  it('list_models sort_by context returns first model with largest context', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'list_models', { sort_by: 'context', limit: 5 });
    assert.ok(!result.isError);
    const data = parseToolResult(result);
    assert.ok(data.models.length > 0);
    assert.ok(
      data.models[0].context_length >= data.models[data.models.length - 1].context_length,
      'sort by context should be descending'
    );
    assert.ok(data.models[0].context_length >= 1_000_000, 'largest context should be >= 1M');
  });

  it('list_models sort_by price returns models in ascending output price order', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'list_models', { sort_by: 'price', limit: 20, free_only: false });
    assert.ok(!result.isError);
    const data = parseToolResult(result);
    for (let i = 0; i < data.models.length - 1; i++) {
      const a = data.models[i].output_per_m ?? Infinity;
      const b = data.models[i + 1].output_per_m ?? Infinity;
      assert.ok(a <= b, `price[${i}]=${a} > price[${i + 1}]=${b} – not sorted`);
    }
  });

  it('list_models with limit:1 returns exactly 1 model', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'list_models', { limit: 1 });
    assert.ok(!result.isError);
    const data = parseToolResult(result);
    assert.equal(data.total, 1);
    assert.equal(data.models.length, 1);
  });

  it('list_models free_only + filter deepseek returns free deepseek models', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'list_models', { free_only: true, filter: 'deepseek', limit: 20 });
    assert.ok(!result.isError);
    const data = parseToolResult(result);
    assert.ok(data.models.length > 0, 'should find free deepseek models');
    for (const model of data.models) {
      assert.equal(model.input_per_m, 0, `${model.id} should be free (input)`);
      assert.equal(model.output_per_m, 0, `${model.id} should be free (output)`);
      const match = model.id.toLowerCase().includes('deepseek') || (model.name ?? '').toLowerCase().includes('deepseek');
      assert.ok(match, `${model.id} should match deepseek filter`);
    }
  });

  it('list_models filter for niche provider (aion-labs) returns only that provider', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'list_models', { filter: 'aion-labs', limit: 50 });
    assert.ok(!result.isError);
    const data = parseToolResult(result);
    assert.ok(data.models.length > 0, 'aion-labs models should exist');
    for (const model of data.models) {
      assert.ok(model.id.startsWith('aion-labs/'), `${model.id} should be from aion-labs`);
    }
  });

  it('list_models with no matching filter returns zero models', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'list_models', {
      filter: 'xyznonexistentprovider99999',
      limit: 50,
    });
    assert.ok(!result.isError);
    const data = parseToolResult(result);
    assert.equal(data.total, 0, 'nonexistent filter should return 0 models');
    assert.deepEqual(data.models, []);
  });

  it('get_benchmarks for niche solidity model returns null ELO', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'get_benchmarks', {
      model_id: 'alfredpros/codellama-7b-instruct-solidity',
    });
    assert.ok(!result.isError);
    const data = parseToolResult(result);
    assert.equal(data.lmarena_elo, null, 'obscure model should have no LMArena data');
  });

  it('get_benchmarks for ultra-cheap nova-micro returns model_id correctly', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'get_benchmarks', { model_id: 'amazon/nova-micro-v1' });
    assert.ok(!result.isError);
    const data = parseToolResult(result);
    assert.equal(data.model_id, 'amazon/nova-micro-v1');
    assert.ok('lmarena_elo' in data, 'lmarena_elo field expected');
  });

  it('compare_models same model vs itself returns identical pricing', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'compare_models', {
      model_a: 'openai/o1-pro',
      model_b: 'openai/o1-pro',
    });
    assert.ok(!result.isError);
    const data = parseToolResult(result);
    assert.equal(data.a.id, data.b.id, 'same model should have same id');
    assert.equal(data.a.output_per_m, data.b.output_per_m, 'same model should have same price');
    assert.equal(data.a.context_length, data.b.context_length, 'same context_length');
  });

  it('compare_models most expensive vs cheapest shows huge price ratio', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'compare_models', {
      model_a: 'openai/o1-pro',
      model_b: 'amazon/nova-micro-v1',
    });
    assert.ok(!result.isError);
    const data = parseToolResult(result);
    assert.ok(
      data.a.output_per_m > data.b.output_per_m * 100,
      `o1-pro ($${data.a.output_per_m}/M) should be >> nova-micro ($${data.b.output_per_m}/M)`
    );
  });

  it('compare_models free model vs paid model shows price difference', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'compare_models', {
      model_a: 'deepseek/deepseek-v4-flash:free',
      model_b: 'amazon/nova-micro-v1',
    });
    assert.ok(!result.isError);
    const data = parseToolResult(result);
    assert.equal(data.a.output_per_m, 0, 'free model output should be 0');
    assert.ok(data.b.output_per_m > 0, 'paid model output should be > 0');
  });

  it('best_for_task vision returns models with vision capability', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'best_for_task', { task: 'vision', limit: 5 });
    assert.ok(!result.isError);
    const data = parseToolResult(result);
    assert.equal(data.task, 'vision');
    assert.ok(data.results.length > 0, 'vision task should have results');
    for (const item of data.results) {
      assert.ok(Array.isArray(item.features), 'features expected');
      assert.ok(item.features.includes('vision'), `${item.id} should have vision feature`);
    }
  });

  it('best_for_task cheap with limit:1 returns exactly 1 result', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'best_for_task', { task: 'cheap', limit: 1 });
    assert.ok(!result.isError);
    const data = parseToolResult(result);
    assert.equal(data.results.length, 1, 'should return exactly 1 result');
    assert.equal(typeof data.results[0].score, 'number');
  });

  it('best_for_task with budget:0 returns only free models', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'best_for_task', {
      task: 'general',
      max_price_per_m_output: 0,
      limit: 10,
    });
    assert.ok(!result.isError);
    const data = parseToolResult(result);
    for (const item of data.results) {
      assert.equal(item.output_per_m, 0, `${item.id} should be free (budget=0)`);
    }
  });

  it('best_for_task with negative budget returns empty results', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'best_for_task', {
      task: 'general',
      max_price_per_m_output: -1,
      limit: 10,
    });
    assert.ok(!result.isError);
    const data = parseToolResult(result);
    assert.deepEqual(data.results, [], 'negative budget should exclude everything');
  });

  it('best_for_task results are sorted descending by score', { timeout: ONLINE_TIMEOUT }, async () => {
    const result = await callToolWithRetry(client, 'best_for_task', { task: 'coding', limit: 10 });
    assert.ok(!result.isError);
    const data = parseToolResult(result);
    assert.ok(data.results.length > 1, 'need multiple results to verify order');
    for (let i = 0; i < data.results.length - 1; i++) {
      assert.ok(
        data.results[i].score >= data.results[i + 1].score,
        `score[${i}]=${data.results[i].score} < score[${i + 1}]=${data.results[i + 1].score}`
      );
    }
  });
});

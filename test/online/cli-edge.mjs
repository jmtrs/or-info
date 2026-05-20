/**
 * Edge-case CLI tests: unusual model IDs, niche providers, boundary inputs.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { contextLength, pricePerMillion } from '../../lib/openrouter.mjs';
import { ONLINE_TIMEOUT, parseJson, runCli } from '../helpers/online.mjs';
import { createIsolatedAppEnv } from '../helpers/runtime.mjs';

describe('CLI edge – models unusual queries', () => {
  let isolated;

  before(async () => {
    isolated = await createIsolatedAppEnv('cli-edge-models');
  });

  after(async () => {
    await isolated.cleanup();
  });

  it('--filter is case-insensitive (CLAUDE matches claude models)', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['models', '--filter', 'CLAUDE', '--json'], { env: isolated.env });
    const out = parseJson(stdout);
    assert.ok(out.length > 0, 'should find models');
    for (const m of out) {
      const match = m.id.toLowerCase().includes('claude') || (m.name ?? '').toLowerCase().includes('claude');
      assert.ok(match, `${m.id} does not match CLAUDE case-insensitively`);
    }
  });

  it('--sort context returns models with descending context length', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['models', '--sort', 'context', '--json'], { env: isolated.env });
    const out = parseJson(stdout);
    assert.ok(out.length > 1, 'need multiple models');
    const first = contextLength(out[0]);
    const second = contextLength(out[1]);
    assert.ok(first >= second, `context[0]=${first} should be >= context[1]=${second}`);
    assert.ok(first >= 1_000_000, 'largest context should be at least 1M tokens');
  });

  it('--filter with hyphenated niche provider (aion-labs)', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['models', '--filter', 'aion-labs', '--json'], { env: isolated.env });
    const out = parseJson(stdout);
    assert.ok(out.length > 0, 'aion-labs models should exist');
    for (const m of out) {
      assert.ok(m.id.startsWith('aion-labs/'), `${m.id} should belong to aion-labs`);
    }
  });

  it('--free --filter combined returns only free matching models', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['models', '--free', '--filter', 'deepseek', '--json'], { env: isolated.env });
    const out = parseJson(stdout);
    assert.ok(out.length > 0, 'should find free deepseek models');
    for (const m of out) {
      const p = pricePerMillion(m);
      assert.equal(p.input, 0, `${m.id} input should be 0`);
      assert.equal(p.output, 0, `${m.id} output should be 0`);
      const match = m.id.toLowerCase().includes('deepseek') || (m.name ?? '').toLowerCase().includes('deepseek');
      assert.ok(match, `${m.id} should match deepseek`);
    }
  });

  it('--filter for very long descriptive model name', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['models', '--filter', 'dolphin-mistral-24b-venice', '--json'], { env: isolated.env });
    const out = parseJson(stdout);
    assert.ok(out.length >= 1, 'dolphin-mistral-24b-venice model should exist');
    assert.ok(out[0].id.includes('dolphin'), `found: ${out[0].id}`);
  });

  it('--filter for nonexistent provider returns empty array', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['models', '--filter', 'xyznonexistentprovider99999', '--json'], { env: isolated.env });
    const out = parseJson(stdout);
    assert.deepEqual(out, [], 'should return empty array');
  });

  it('models with :free suffix appear in --free list', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['models', '--free', '--json'], { env: isolated.env });
    const out = parseJson(stdout);
    const freeVariant = out.find((m) => m.id.endsWith(':free'));
    assert.ok(freeVariant, 'should find at least one :free-suffix model in free list');
  });
});

describe('CLI edge – price unusual models', () => {
  let isolated;

  before(async () => {
    isolated = await createIsolatedAppEnv('cli-edge-price');
  });

  after(async () => {
    await isolated.cleanup();
  });

  it('model with :free suffix has zero prices', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['price', 'deepseek/deepseek-v4-flash:free', '--json'], { env: isolated.env });
    const out = parseJson(stdout);
    assert.equal(out.model, 'deepseek/deepseek-v4-flash:free');
    assert.equal(Number(out.pricing.completion), 0, 'output price should be 0');
    assert.equal(Number(out.pricing.prompt), 0, 'input price should be 0');
  });

  it('alias model with ~ prefix resolves correctly', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['price', '~anthropic/claude-sonnet-latest', '--json'], { env: isolated.env });
    const out = parseJson(stdout);
    assert.equal(out.model, '~anthropic/claude-sonnet-latest');
    assert.ok(Number(out.pricing.prompt) > 0, 'alias should have nonzero pricing');
  });

  it('ultra-cheap model (amazon/nova-micro-v1) has very low output price', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['price', 'amazon/nova-micro-v1', '--json'], { env: isolated.env });
    const out = parseJson(stdout);
    const outputPerM = Number(out.pricing.completion) * 1_000_000;
    assert.ok(outputPerM < 1, `nova-micro output $${outputPerM}/M should be under $1`);
    assert.ok(outputPerM > 0, 'should not be free');
    assert.equal(out.context_length, 128000);
  });

  it('ultra-expensive model (openai/o1-pro) has very high output price', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['price', 'openai/o1-pro', '--json'], { env: isolated.env });
    const out = parseJson(stdout);
    const outputPerM = Number(out.pricing.completion) * 1_000_000;
    assert.ok(outputPerM >= 100, `o1-pro output $${outputPerM}/M should be >= $100`);
  });

  it('tiny-context model (alfredpros/codellama-7b-instruct-solidity) reports 4096 context', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['price', 'alfredpros/codellama-7b-instruct-solidity', '--json'], { env: isolated.env });
    const out = parseJson(stdout);
    assert.equal(out.context_length, 4096, 'solidity model has tiny context');
  });

  it('niche provider with hyphen (anthracite-org) resolves correctly', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['price', 'anthracite-org/magnum-v4-72b', '--json'], { env: isolated.env });
    const out = parseJson(stdout);
    assert.equal(out.model, 'anthracite-org/magnum-v4-72b');
    assert.ok(typeof out.pricing === 'object', 'pricing expected');
  });
});

describe('CLI edge – benchmark', () => {
  let isolated;

  before(async () => {
    isolated = await createIsolatedAppEnv('cli-edge-benchmark');
  });

  after(async () => {
    await isolated.cleanup();
  });

  it('niche solidity model returns null ELO (not in LMArena)', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['benchmark', 'alfredpros/codellama-7b-instruct-solidity', '--json'], { env: isolated.env });
    const out = parseJson(stdout);
    assert.equal(out.elo, null, 'obscure model should have no LMArena data');
  });

  it('ultra-cheap model (amazon/nova-micro-v1) benchmark returns valid JSON', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['benchmark', 'amazon/nova-micro-v1', '--json'], { env: isolated.env });
    const out = parseJson(stdout);
    assert.equal(out.model, 'amazon/nova-micro-v1');
    assert.ok('elo' in out, 'elo field expected');
  });
});

describe('CLI edge – compare', () => {
  let isolated;

  before(async () => {
    isolated = await createIsolatedAppEnv('cli-edge-compare');
  });

  after(async () => {
    await isolated.cleanup();
  });

  it('comparing a model with itself returns identical a/b data', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['compare', 'openai/o1-pro', 'openai/o1-pro', '--json'], { env: isolated.env });
    const out = parseJson(stdout);
    assert.equal(out.a.model.id, out.b.model.id, 'a and b should be the same model');
    assert.deepEqual(out.a.model.pricing, out.b.model.pricing, 'pricing should be identical');
  });

  it('comparing ultra-expensive vs ultra-cheap shows very different prices', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['compare', 'openai/o1-pro', 'amazon/nova-micro-v1', '--json'], { env: isolated.env });
    const out = parseJson(stdout);
    const priceA = pricePerMillion(out.a.model).output;
    const priceB = pricePerMillion(out.b.model).output;
    assert.ok(priceA > priceB * 100, `o1-pro ($${priceA}/M) should cost >> nova-micro ($${priceB}/M)`);
  });

  it('comparing two free models works without error', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli([
      'compare',
      'deepseek/deepseek-v4-flash:free',
      'meta-llama/llama-3.3-70b-instruct:free',
      '--json',
    ], { env: isolated.env });
    const out = parseJson(stdout);
    const pA = pricePerMillion(out.a.model);
    const pB = pricePerMillion(out.b.model);
    assert.equal(pA.output, 0, 'a should be free');
    assert.equal(pB.output, 0, 'b should be free');
  });
});

describe('CLI edge – top', () => {
  let isolated;

  before(async () => {
    isolated = await createIsolatedAppEnv('cli-edge-top');
  });

  after(async () => {
    await isolated.cleanup();
  });

  it('--task vision returns vision-capable models', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['top', '--task', 'vision', '--limit', '5', '--json'], { env: isolated.env });
    const out = parseJson(stdout);
    assert.ok(Array.isArray(out) && out.length > 0, 'vision task should have results');
    for (const r of out) {
      assert.equal(typeof r.id, 'string');
      assert.equal(typeof r.score, 'number');
    }
  });

  it('--task cheap with --limit 1 returns exactly 1 result', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['top', '--task', 'cheap', '--limit', '1', '--json'], { env: isolated.env });
    const out = parseJson(stdout);
    assert.equal(out.length, 1, 'should return exactly 1 model');
    assert.equal(typeof out[0].score, 'number');
  });

  it('--budget 0 restricts to free models only', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['top', '--budget', '0', '--limit', '10', '--json'], { env: isolated.env });
    const out = parseJson(stdout);
    assert.ok(out.length > 0, 'some free models should have ELO data');
  });

  it('--task reasoning returns scored results', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['top', '--task', 'reasoning', '--limit', '3', '--json'], { env: isolated.env });
    const out = parseJson(stdout);
    assert.ok(out.length > 0, 'reasoning task should have results');
    for (let i = 0; i < out.length - 1; i++) {
      assert.ok(out[i].score >= out[i + 1].score, 'results should be sorted by score desc');
    }
  });

  it('no results message when budget is impossibly negative (exit 0)', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['top', '--budget', '-0.01'], { env: isolated.env });
    assert.ok(stdout.includes('No results'), 'should print no-results message');
  });
});

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pricePerMillion } from '../../lib/openrouter.mjs';
import { runCli, parseJson, ONLINE_TIMEOUT } from '../helpers/online.mjs';
import { createIsolatedAppEnv } from '../helpers/runtime.mjs';

describe('CLI – models', () => {
  let isolated;

  before(async () => {
    isolated = await createIsolatedAppEnv('cli-online');
  });

  after(async () => {
    await isolated.cleanup();
  });

  it('returns a non-empty array with expected fields', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['models', '--json'], { env: isolated.env });
    const out = parseJson(stdout);
    assert.ok(Array.isArray(out), 'output should be an array');
    assert.ok(out.length > 0, 'should have at least one model');
    const m = out[0];
    assert.equal(typeof m.id, 'string', 'id should be a string');
    assert.equal(typeof m.pricing, 'object', 'pricing should be an object');
  });

  it('--filter narrows results to matching models', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['models', '--filter', 'claude', '--json'], { env: isolated.env });
    const out = parseJson(stdout);
    assert.ok(out.length > 0, 'should find claude models');
    for (const m of out) {
      const match =
        m.id.toLowerCase().includes('claude') ||
        (m.name ?? '').toLowerCase().includes('claude');
      assert.ok(match, `model ${m.id} does not match filter "claude"`);
    }
  });

  it('--free returns only zero-price models', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['models', '--free', '--json'], { env: isolated.env });
    const out = parseJson(stdout);
    assert.ok(out.length > 0, 'should have at least one free model');
    for (const m of out) {
      const p = pricePerMillion(m);
      assert.equal(p.input, 0, `${m.id} input price should be 0`);
      assert.equal(p.output, 0, `${m.id} output price should be 0`);
    }
  });

  it('--sort price returns models in ascending output price order', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['models', '--sort', 'price', '--json'], { env: isolated.env });
    const out = parseJson(stdout);
    assert.ok(out.length > 1, 'need multiple models to verify sort');
    for (let i = 0; i < Math.min(out.length - 1, 30); i++) {
      const pa = pricePerMillion(out[i]).output ?? Infinity;
      const pb = pricePerMillion(out[i + 1]).output ?? Infinity;
      assert.ok(pa <= pb, `model[${i}] price ${pa} > model[${i + 1}] price ${pb}`);
    }
  });
});

describe('CLI – price', () => {
  let isolated;

  before(async () => {
    isolated = await createIsolatedAppEnv('cli-price');
  });

  after(async () => {
    await isolated.cleanup();
  });

  it('returns pricing and context for a known model', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['price', 'anthropic/claude-3-haiku', '--json'], { env: isolated.env });
    const out = parseJson(stdout);
    assert.equal(typeof out.model, 'string');
    assert.equal(typeof out.pricing, 'object');
    assert.ok('context_length' in out, 'context_length field expected');
  });

  it('exits with code 1 for an unknown model', { timeout: ONLINE_TIMEOUT }, async () => {
    await runCli(['price', 'nonexistent/model-xyz-00000'], {
      env: isolated.env,
      expectExit: 1,
    });
  });
});

describe('CLI – benchmark', () => {
  let isolated;

  before(async () => {
    isolated = await createIsolatedAppEnv('cli-benchmark');
  });

  after(async () => {
    await isolated.cleanup();
  });

  it('returns model and elo fields (elo may be null)', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['benchmark', 'anthropic/claude-3-haiku', '--json'], { env: isolated.env });
    const out = parseJson(stdout);
    assert.equal(typeof out.model, 'string');
    assert.ok('elo' in out, 'elo field expected');
  });
});

describe('CLI – compare', () => {
  let isolated;

  before(async () => {
    isolated = await createIsolatedAppEnv('cli-compare');
  });

  after(async () => {
    await isolated.cleanup();
  });

  it('returns a/b objects with model data', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli([
      'compare',
      'anthropic/claude-3-haiku',
      'openai/gpt-4o-mini',
      '--json',
    ], { env: isolated.env });
    const out = parseJson(stdout);
    assert.equal(typeof out.a, 'object', 'a object expected');
    assert.equal(typeof out.b, 'object', 'b object expected');
    assert.equal(out.a.model.id, 'anthropic/claude-3-haiku');
    assert.equal(out.b.model.id, 'openai/gpt-4o-mini');
  });

  it('exits with code 1 when a model is not found', { timeout: ONLINE_TIMEOUT }, async () => {
    await runCli(['compare', 'nonexistent/model-abc', 'openai/gpt-4o-mini'], {
      env: isolated.env,
      expectExit: 1,
    });
  });
});

describe('CLI – top', () => {
  let isolated;

  before(async () => {
    isolated = await createIsolatedAppEnv('cli-top');
  });

  after(async () => {
    await isolated.cleanup();
  });

  it('returns ranked models for coding task respecting --limit', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['top', '--task', 'coding', '--limit', '3', '--json'], { env: isolated.env });
    const out = parseJson(stdout);
    assert.ok(Array.isArray(out), 'should be an array');
    assert.ok(out.length > 0, 'should have results');
    assert.ok(out.length <= 3, 'should respect --limit 3');
    for (const r of out) {
      assert.equal(typeof r.id, 'string', 'each result needs id');
      assert.equal(typeof r.score, 'number', 'each result needs score');
    }
  });

  it('--budget filters results by max output price', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli([
      'top',
      '--task',
      'general',
      '--budget',
      '2.0',
      '--limit',
      '5',
      '--json',
    ], { env: isolated.env });
    const out = parseJson(stdout);
    assert.ok(Array.isArray(out), 'should be an array');
    for (const r of out) {
      assert.equal(typeof r.score, 'number', 'each result needs score');
    }
  });
});

describe('CLI – status', () => {
  let isolated;

  before(async () => {
    isolated = await createIsolatedAppEnv('cli-status');
  });

  after(async () => {
    await isolated.cleanup();
  });

  it('shows cache status mentioning models and benchmarks', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['status'], { env: isolated.env });
    assert.ok(stdout.toLowerCase().includes('model'), 'output should mention models');
    assert.ok(stdout.toLowerCase().includes('benchmark'), 'output should mention benchmarks');
  });
});

describe('CLI – refresh', () => {
  let isolated;

  before(async () => {
    isolated = await createIsolatedAppEnv('cli-refresh');
  });

  after(async () => {
    await isolated.cleanup();
  });

  it('force-refreshes cache and reports model and ELO counts', { timeout: ONLINE_TIMEOUT }, async () => {
    const { stdout } = await runCli(['refresh'], { env: isolated.env });
    assert.ok(/\d+ models/.test(stdout), 'should report model count');
    assert.ok(/\d+ entries/.test(stdout), 'should report ELO entry count');
  });
});

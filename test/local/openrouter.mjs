import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  contextLength,
  findModel,
  isFree,
  modelTags,
  pricePerMillion,
  supportsFeature,
} from '../../lib/openrouter.mjs';
import { createIsolatedAppEnv, importFresh, setEnv } from '../helpers/runtime.mjs';

const MOCK_MODEL = {
  id: 'test/model',
  name: 'Test Model',
  context_length: 128000,
  pricing: {
    prompt: '0.000001',
    completion: '0.000003',
    image: '0.000002',
    input_cache_read: '0.0000001',
  },
  architecture: {
    modality: 'text+image->text',
    input_modalities: ['text', 'image'],
    output_modalities: ['text'],
    tokenizer: 'TestTokenizer',
  },
  top_provider: {
    context_length: 200000,
    max_completion_tokens: 8192,
  },
  supported_parameters: ['tools', 'tool_choice', 'include_reasoning'],
};

describe('pricePerMillion', () => {
  it('converts per-token to per-million correctly', () => {
    const p = pricePerMillion(MOCK_MODEL);
    assert.ok(Math.abs(p.input - 1.0) < 1e-9, `input: ${p.input}`);
    assert.ok(Math.abs(p.output - 3.0) < 1e-9, `output: ${p.output}`);
    assert.ok(Math.abs(p.image - 2.0) < 1e-9, `image: ${p.image}`);
    assert.ok(Math.abs(p.cacheRead - 0.1) < 1e-9, `cacheRead: ${p.cacheRead}`);
  });

  it('returns null for missing pricing fields', () => {
    const p = pricePerMillion({ pricing: {} });
    assert.equal(p.input, null);
    assert.equal(p.output, null);
  });

  it('returns null for model without pricing', () => {
    const p = pricePerMillion({});
    assert.equal(p.input, null);
  });
});

describe('contextLength', () => {
  it('prefers top_provider.context_length', () => {
    assert.equal(contextLength(MOCK_MODEL), 200000);
  });

  it('falls back to model.context_length', () => {
    const m = { ...MOCK_MODEL, top_provider: {} };
    assert.equal(contextLength(m), 128000);
  });

  it('returns null for missing values', () => {
    assert.equal(contextLength({}), null);
  });
});

describe('supportsFeature', () => {
  it('detects reasoning support', () => {
    assert.equal(supportsFeature(MOCK_MODEL, 'reasoning'), true);
  });

  it('detects tools support', () => {
    assert.equal(supportsFeature(MOCK_MODEL, 'tools'), true);
  });

  it('detects vision via architecture modalities', () => {
    assert.equal(supportsFeature(MOCK_MODEL, 'vision'), true);
  });

  it('returns false for unsupported features', () => {
    const m = { supported_parameters: [], architecture: { input_modalities: ['text'] } };
    assert.equal(supportsFeature(m, 'reasoning'), false);
    assert.equal(supportsFeature(m, 'vision'), false);
  });
});

describe('modelTags', () => {
  it('returns expected tags for mock model', () => {
    const tags = modelTags(MOCK_MODEL);
    assert.ok(tags.includes('reasoning'));
    assert.ok(tags.includes('tools'));
    assert.ok(tags.includes('vision'));
    assert.ok(tags.includes('long-context'));
  });
});

describe('findModel', () => {
  const models = [
    { id: 'anthropic/claude-sonnet-4.5' },
    { id: 'openai/gpt-4o' },
  ];

  it('finds by exact id', () => {
    assert.equal(findModel(models, 'anthropic/claude-sonnet-4.5')?.id, 'anthropic/claude-sonnet-4.5');
  });

  it('resolves dot → hyphen variant', () => {
    assert.equal(findModel(models, 'anthropic/claude-sonnet-4-5')?.id, 'anthropic/claude-sonnet-4.5');
  });

  it('returns null for unknown model', () => {
    assert.equal(findModel(models, 'unknown/model'), null);
  });
});

describe('isFree', () => {
  it('returns true for :free suffix model', () => {
    const m = { id: 'deepseek/deepseek-v4-flash:free', pricing: { prompt: '0', completion: '0' } };
    assert.equal(isFree(m), true);
  });

  it('returns true for openrouter/free', () => {
    const m = { id: 'openrouter/free', pricing: { prompt: '0', completion: '0' } };
    assert.equal(isFree(m), true);
  });

  it('returns false for zero-price model without :free suffix (API bug)', () => {
    const m = { id: 'z-ai/glm-5.1', pricing: { prompt: '0', completion: '0' } };
    assert.equal(isFree(m), false);
  });

  it('returns false for paid model', () => {
    assert.equal(isFree(MOCK_MODEL), false);
  });
});

describe('fetchModels error handling', () => {
  let isolated;
  let restoreEnv;
  let restoreFetch;

  before(async () => {
    isolated = await createIsolatedAppEnv('openrouter');
    restoreEnv = setEnv({
      OR_INFO_CONFIG_DIR: isolated.configDir,
      OR_INFO_CACHE_DIR: isolated.cacheDir,
    });
  });

  after(async () => {
    restoreFetch?.();
    restoreEnv();
    await isolated.cleanup();
  });

  it('wraps network failures with provider context', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new TypeError('connect ECONNREFUSED api.openrouter.ai');
    };
    restoreFetch = () => {
      global.fetch = originalFetch;
    };

    const { fetchModels } = await importFresh('lib/openrouter.mjs', 'openrouter-network-error');
    await assert.rejects(
      () => fetchModels({ force: true }),
      /OpenRouter request failed: connect ECONNREFUSED api\.openrouter\.ai/
    );
  });
});

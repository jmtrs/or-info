import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreForTask, rankModels } from '../../lib/scorer.mjs';

const CODING_MODEL = {
  id: 'test/coder',
  pricing: { prompt: '0.000001', completion: '0.000003' },
  context_length: 128000,
  architecture: { input_modalities: ['text'] },
  supported_parameters: ['tools', 'tool_choice'],
};

const ELO_ENTRY = {
  lmarenaName: 'test-coder',
  elo: 1280,
  eloLower: 1270,
  eloUpper: 1290,
  votes: 10000,
  rank: 20,
};

describe('scoreForTask', () => {
  it('returns a scored object for valid model + elo + task', () => {
    const result = scoreForTask(CODING_MODEL, ELO_ENTRY, 'coding');
    assert.ok(result !== null);
    assert.ok(typeof result.score === 'number');
    assert.ok(result.score >= 0 && result.score <= 100);
  });

  it('returns null for missing ELO entry', () => {
    assert.equal(scoreForTask(CODING_MODEL, null, 'coding'), null);
  });

  it('returns null for vision task on non-vision model', () => {
    assert.equal(scoreForTask(CODING_MODEL, ELO_ENTRY, 'vision'), null);
  });

  it('cheap task applies more aggressive price penalty', () => {
    const resultGeneral = scoreForTask(CODING_MODEL, ELO_ENTRY, 'general');
    const resultCheap = scoreForTask(CODING_MODEL, ELO_ENTRY, 'cheap');
    assert.notEqual(resultCheap?.score, resultGeneral?.score);
  });
});

describe('rankModels', () => {
  const models = [
    CODING_MODEL,
    {
      id: 'test/free',
      pricing: { prompt: '0', completion: '0' },
      context_length: 8000,
      architecture: { input_modalities: ['text'] },
      supported_parameters: [],
    },
  ];

  const allElo = [
    ELO_ENTRY,
    { lmarenaName: 'test-free', elo: 1150, eloLower: 1140, eloUpper: 1160, votes: 5000, rank: 60 },
  ];

  it('returns array sorted by descending score', () => {
    const ranked = rankModels(models, allElo, { task: 'general', limit: 10 });
    assert.ok(ranked.length > 0);
    for (let i = 1; i < ranked.length; i++) {
      assert.ok(ranked[i - 1].score >= ranked[i].score);
    }
  });

  it('respects limit', () => {
    const ranked = rankModels(models, allElo, { task: 'general', limit: 1 });
    assert.equal(ranked.length, 1);
  });

  it('filters by maxPricePerMOutput', () => {
    const ranked = rankModels(models, allElo, { task: 'general', maxPricePerMOutput: 1 });
    assert.ok(ranked.every((r) => r.model.id !== 'test/coder'));
  });
});

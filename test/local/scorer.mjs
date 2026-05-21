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

const NO_TOOLS_MODEL = {
  id: 'test/no-tools',
  pricing: { prompt: '0', completion: '0' },
  context_length: 128000,
  architecture: { input_modalities: ['text'] },
  supported_parameters: [],
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

  it('cheap task applies steeper price penalty than general', () => {
    const resultGeneral = scoreForTask(CODING_MODEL, ELO_ENTRY, 'general');
    const resultCheap = scoreForTask(CODING_MODEL, ELO_ENTRY, 'cheap');
    assert.ok(resultCheap.score < resultGeneral.score,
      `cheap (${resultCheap.score}) should penalise $3/M more than general (${resultGeneral.score})`);
  });

  it('score never exceeds 100', () => {
    const topElo = { ...ELO_ENTRY, elo: 1540 };
    const result = scoreForTask(NO_TOOLS_MODEL, topElo, 'cheap');
    assert.ok(result.score <= 100, `score ${result.score} exceeds 100`);
  });

  it('premium task ignores price', () => {
    const expensiveModel = {
      ...CODING_MODEL,
      pricing: { prompt: '0.000075', completion: '0.000075' },
    };
    const premium = scoreForTask(expensiveModel, ELO_ENTRY, 'premium');
    const general = scoreForTask(expensiveModel, ELO_ENTRY, 'general');
    assert.ok(premium.score > general.score,
      `premium (${premium.score}) should not penalise $75/M, general (${general.score}) does`);
  });

  it('coding without tools applies soft penalty, not exclusion', () => {
    const result = scoreForTask(NO_TOOLS_MODEL, ELO_ENTRY, 'coding');
    assert.ok(result !== null, 'model without tools should still score for coding');
    const withTools = scoreForTask(CODING_MODEL, ELO_ENTRY, 'coding');
    assert.ok(result.score < withTools.score,
      `no-tools (${result.score}) should score lower than with-tools (${withTools.score})`);
  });

  it('context bonus rewards larger context windows', () => {
    const smallCtx = { ...CODING_MODEL, context_length: 8000 };
    const resultSmall = scoreForTask(smallCtx, ELO_ENTRY, 'general');
    const resultLarge = scoreForTask(CODING_MODEL, ELO_ENTRY, 'general');
    assert.ok(resultLarge.score > resultSmall.score,
      `128k ctx (${resultLarge.score}) should score higher than 8k (${resultSmall.score})`);
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

  it('deduplicates :free and paid variants of the same model', () => {
    const dupModels = [
      { id: 'test/testmodel-free:free', pricing: { prompt: '0', completion: '0' }, context_length: 8000,
        architecture: { input_modalities: ['text'] }, supported_parameters: [] },
      { id: 'test/testmodel-free', pricing: { prompt: '0.000001', completion: '0.000001' }, context_length: 8000,
        architecture: { input_modalities: ['text'] }, supported_parameters: [] },
    ];
    const dupElo = [
      { lmarenaName: 'testmodel-free', elo: 1300, eloLower: 1290, eloUpper: 1310, votes: 5000, rank: 10 },
    ];
    const ranked = rankModels(dupModels, dupElo, { task: 'general', limit: 10 });
    const ids = ranked.map((r) => r.model.id);
    assert.ok(ids.length === 1, `expected 1, got ${ids.length}: ${ids.join(', ')}`);
    assert.equal(ids[0], 'test/testmodel-free:free', 'free variant should win (same ELO, better price)');
  });
});

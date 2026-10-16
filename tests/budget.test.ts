import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultBudgetConfig, estimateCost, InMemoryBudgetManager } from '../src/budget.js';
import type { TokenPricing } from '../src/budget.js';

// Synthetic arithmetic rates only; these are not real provider prices.
const pricing: TokenPricing = { inputMicroUsdPerMillion: 1_000_000, outputMicroUsdPerMillion: 2_000_000, source: 'unit-test synthetic rates', verifiedOn: '2026-10-16' };

test('cost accounting rounds up, validates inputs, and rejects unsourced rates', () => {
  assert.equal(estimateCost({ inputTokens: 10, outputTokens: 20 }, pricing), 50);
  assert.equal(estimateCost({ inputTokens: 1, outputTokens: 0 }, { ...pricing, inputMicroUsdPerMillion: 1 }), 1);
  assert.throws(() => estimateCost({ inputTokens: -1, outputTokens: 0 }, pricing));
  assert.throws(() => estimateCost({ inputTokens: 1.5, outputTokens: 0 }, pricing));
  assert.throws(() => estimateCost({ inputTokens: 1, outputTokens: 0 }, { ...pricing, source: '' }));
});

test('pending reservations count toward the $8 stop and $5 target', () => {
  const manager = new InMemoryBudgetManager();
  manager.reserve('a', { inputTokens: 5_000_000, outputTokens: 0 }, pricing);
  assert.equal(manager.snapshot().targetReached, true);
  const reservation = manager.reserve('b', { inputTokens: 3_000_000, outputTokens: 0 }, pricing);
  assert.throws(() => manager.reserve('c', { inputTokens: 1, outputTokens: 0 }, pricing), /hard stop/);
  const totals = manager.settle(reservation.id, { inputTokens: 1_000_000, outputTokens: 0 });
  assert.equal(totals.costMicroUsd, 1_000_000);
  assert.equal(manager.snapshot().reservedMicroUsd, 5_000_000);
  manager.reserve('c', { inputTokens: 2_000_000, outputTokens: 0 }, pricing);
  assert.throws(() => manager.settle(reservation.id, { inputTokens: 0, outputTokens: 0 }));
});

test('invalid limits cannot raise the agreed hard stop or absolute maximum', () => {
  assert.throws(() => new InMemoryBudgetManager({ ...defaultBudgetConfig, hardStopMicroUsd: 9_000_000 }));
  assert.throws(() => new InMemoryBudgetManager({ ...defaultBudgetConfig, absoluteMaximumMicroUsd: 11_000_000 }));
  assert.throws(() => new InMemoryBudgetManager({ ...defaultBudgetConfig, targetMicroUsd: NaN }));
});

test('late settlements stay in reservation month; per-run totals accumulate', () => {
  let date = new Date('2026-10-31T23:59:59Z');
  const manager = new InMemoryBudgetManager(defaultBudgetConfig, () => date);
  const october = manager.reserve('run', { inputTokens: 100, outputTokens: 0 }, pricing);
  date = new Date('2026-11-01T00:00:00Z');
  manager.settle(october.id, { inputTokens: 80, outputTokens: 0 });
  assert.equal(manager.snapshot().spentMicroUsd, 0);
  const november = manager.reserve('run', { inputTokens: 10, outputTokens: 5 }, pricing);
  manager.settle(november.id, { inputTokens: 10, outputTokens: 5 });
  assert.equal(manager.snapshot().spentMicroUsd, 20);
  assert.deepEqual(manager.runAccounting('run'), { usage: { inputTokens: 90, outputTokens: 5 }, costMicroUsd: 100 });
});

test('usage beyond a reservation is recorded and disables further requests', () => {
  const manager = new InMemoryBudgetManager();
  const entry = manager.reserve('run', { inputTokens: 10, outputTokens: 0 }, pricing);
  assert.equal(manager.settle(entry.id, { inputTokens: 11, outputTokens: 0 }).costMicroUsd, 11);
  assert.throws(() => manager.reserve('run', { inputTokens: 1, outputTokens: 0 }, pricing), /hard stop/);
});

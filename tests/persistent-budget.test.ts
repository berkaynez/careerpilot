import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileBudgetManager } from '../src/persistent-budget.js';

// Synthetic arithmetic rates; not real model pricing.
const pricing = { inputMicroUsdPerMillion: 1_000_000, outputMicroUsdPerMillion: 2_000_000,
  source: 'unit-test synthetic rates', verifiedOn: '2026-10-16' };
const usage = (inputTokens: number, outputTokens = 0) => ({ inputTokens, outputTokens });
const pathFor = (t: { after(fn: () => void): void }) => {
  const directory = mkdtempSync(join(tmpdir(), 'careerpilot-budget-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, 'budget.jsonl');
};

test('file ledger persists spent and pending requests across restarts and stops at $5', t => {
  const path = pathFor(t);
  const first = new FileBudgetManager(path, 5_000_000, undefined, 8_000_000); // Isolate monthly limit.
  const reservation = first.reserve('run-a', usage(3_000_000), pricing);
  first.settle(reservation.id, usage(2_000_000));
  first.reserve('run-b', usage(3_000_000), pricing);
  const restarted = new FileBudgetManager(path);
  assert.equal(restarted.snapshot().spentMicroUsd, 2_000_000);
  assert.equal(restarted.snapshot().reservedMicroUsd, 3_000_000);
  assert.equal(restarted.runAccounting('run-b').costMicroUsd, 3_000_000);
  assert.throws(() => restarted.reserve('run-c', usage(1), pricing), /BUDGET_MONTHLY_STOP/);
  assert.match(readFileSync(path, 'utf8'), /"kind":"settle"/);
});

test('shared ledger enforces configured limits up to $8 without resetting historical spending', t => {
  const path = pathFor(t);
  const first = new FileBudgetManager(path, 8_000_000, undefined, 8_000_000);
  first.reserve('a', usage(6_000_000), pricing);
  const lowered = new FileBudgetManager(path); // Existing spend can exceed new limit.
  assert.throws(() => lowered.reserve('b', usage(1), pricing), /BUDGET_MONTHLY_STOP/);
  const second = new FileBudgetManager(path, 8_000_000, undefined, 8_000_000);
  second.reserve('b', usage(2_000_000), pricing);
  assert.throws(() => first.reserve('c', usage(1), pricing), /BUDGET_MONTHLY_STOP/);
  assert.throws(() => new FileBudgetManager(path, 8_000_001), /BUDGET_LIMIT_INVALID/);
});

test('truncation, corrupt records and abandoned locks fail closed', t => {
  const path = pathFor(t);
  writeFileSync(path, '{partial');
  assert.throws(() => new FileBudgetManager(path), /TRUNCATED/);
  assert.equal(readFileSync(path, 'utf8'), '{partial');
  writeFileSync(path, '{}\n');
  assert.throws(() => new FileBudgetManager(path), /UNAVAILABLE/);
  writeFileSync(path, ''); writeFileSync(`${path}.lock`, 'abandoned');
  assert.throws(() => new FileBudgetManager(path), /LOCKED/);
});

test('month rollover preserves previous reservations and late settlement attribution', t => {
  const path = pathFor(t);
  let now = new Date('2026-10-31T23:59:59Z');
  const first = new FileBudgetManager(path, 5_000_000, () => now, 5_000_000);
  const reservation = first.reserve('october', usage(5_000_000), pricing);
  now = new Date('2026-11-01T00:00:01Z');
  const restarted = new FileBudgetManager(path, 5_000_000, () => now);
  assert.equal(restarted.snapshot().reservedMicroUsd, 0);
  restarted.settle(reservation.id, usage(4_000_000));
  assert.equal(restarted.snapshot().spentMicroUsd, 0);
  assert.equal(restarted.runAccounting('october').costMicroUsd, 4_000_000);
});

test('usage exceeding a reservation remains recorded and blocks further calls after restart', t => {
  const path = pathFor(t);
  const manager = new FileBudgetManager(path);
  const reservation = manager.reserve('run', usage(10), pricing);
  manager.settle(reservation.id, usage(11));
  const restarted = new FileBudgetManager(path);
  assert.equal(restarted.runAccounting('run').costMicroUsd, 11);
  assert.throws(() => restarted.reserve('new', usage(1), pricing), /BUDGET_MONTHLY_STOP/);
});

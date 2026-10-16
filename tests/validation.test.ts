import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentDecision, BrowserObservation } from '../src/contracts.js';
import { fictionalCandidate, fictionalPersonalData } from '../src/profile.js';
import { defaultApplicationPolicy } from '../src/policy.js';
import { validateDecision, validateLocalOrigin } from '../src/validation.js';

const observation: BrowserObservation = {
  id: 'obs-1', origin: 'http://127.0.0.1:3000', title: 'Form', text: '', errors: [],
  controls: [
    { id: 'a', kind: 'text', label: 'Unfamiliar wording', help: '', required: true, options: [] },
    { id: 'b', kind: 'text', label: 'Contact', help: '', required: true, options: [] },
    { id: 'submit', kind: 'button', buttonEffect: 'submission', label: 'Send', help: '', required: false, options: [] },
  ],
};
const policy = { ...defaultApplicationPolicy, allowedOrigin: observation.origin };
const validate = (decision: AgentDecision, count = 0) => validateDecision(decision, observation, fictionalCandidate, fictionalPersonalData, policy, count);
const batch: AgentDecision = {
  kind: 'batch', observationId: observation.id,
  actions: [
    { kind: 'fill', elementId: 'a', answer: { kind: 'fact', claim: { factId: 'experience.role', value: 'Software Engineer' } } },
    { kind: 'fill', elementId: 'b', answer: { kind: 'personal-reference', referenceId: 'personal.email' } },
  ],
};

test('low-risk batches accept references, reject stale observations and action-limit excess', () => {
  assert.equal(validate(batch).ok, true);
  assert.equal(validate({ ...batch, observationId: 'old' }).ok, false);
  assert.equal(validate(batch, 59).ok, false);
  assert.equal(validate({ ...batch, actions: [] }).ok, false);
  assert.equal(validate({ ...batch, actions: [batch.actions[0]!, batch.actions[0]!] }).ok, false);
});

test('submission cannot bypass consent or be batched', () => {
  const decision: AgentDecision = { kind: 'action', observationId: observation.id, action: { kind: 'submit', elementId: 'submit', consentId: 'application.submit' } };
  assert.equal(validate(decision).ok, false);
  assert.equal(validate({ kind: 'action', observationId: observation.id, action: { kind: 'click', elementId: 'submit' } }).ok, false);
  assert.equal(validateDecision(decision, observation, fictionalCandidate, fictionalPersonalData,
    { ...policy, consent: { 'application.submit': true } }, 0).ok, true);
  // Simulate a malformed model response that slipped past a future schema parser.
  const unsafe = { kind: 'batch', observationId: observation.id, actions: [decision.action] } as unknown as AgentDecision;
  assert.equal(validate(unsafe).ok, false);
});

test('origin guard requires exact loopback origin including port', () => {
  assert.equal(validateLocalOrigin(observation.origin, observation.origin).ok, true);
  for (const origin of ['http://127.0.0.1:3001', 'http://localhost:3000', 'https://jobs.example', 'file:///tmp/form.html']) {
    assert.equal(validateLocalOrigin(origin, observation.origin).ok, false);
  }
  assert.equal(validateLocalOrigin(observation.origin, null).ok, false);
});

test('candidate answers cannot introduce invented facts or unknown local references', () => {
  assert.equal(validate({ kind: 'action', observationId: observation.id, action: {
    kind: 'fill', elementId: 'a', answer: { kind: 'fact', claim: { factId: 'experience.role', value: 'CEO' } },
  } }).ok, false);
  assert.equal(validate({ kind: 'action', observationId: observation.id, action: {
    kind: 'fill', elementId: 'b', answer: { kind: 'personal-reference', referenceId: 'personal.passport' },
  } }).ok, false);
  assert.equal(validate({ kind: 'action', observationId: observation.id, action: {
    kind: 'fill', elementId: 'missing', answer: { kind: 'personal-reference', referenceId: 'personal.email' },
  } }).ok, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { fictionalCandidate } from '../src/profile.js';
import { defaultApplicationPolicy, validateClaim, validateConsent, validateSalary, validateWorkAuthorization } from '../src/policy.js';
import type { ApplicationPolicy, SalaryOffer } from '../src/policy.js';

test('fictional facts have unique IDs and explicit provenance', () => {
  assert.equal(new Set(fictionalCandidate.facts.map(fact => fact.id)).size, fictionalCandidate.facts.length);
  for (const fact of fictionalCandidate.facts) {
    assert.equal(fact.provenance.kind, 'fictional-fixture');
    assert.match(fact.provenance.source, /fictional|demonstration/);
  }
});

test('factual claims reject invented, changed, and ambiguous facts', () => {
  assert.equal(validateClaim(fictionalCandidate, { factId: 'experience.role', value: 'Software Engineer' }).ok, true);
  assert.equal(validateClaim(fictionalCandidate, { factId: 'experience.role', value: 'Senior Engineer' }).ok, false);
  assert.equal(validateClaim(fictionalCandidate, { factId: 'salary', value: 123 }).ok, false);
  const duplicate = { ...fictionalCandidate, facts: [...fictionalCandidate.facts, fictionalCandidate.facts[0]!] };
  assert.equal(validateClaim(duplicate, { factId: 'experience.role', value: 'Software Engineer' }).ok, false);
});

test('authorization is explicit per country, consent defaults to denied', () => {
  assert.equal(validateWorkAuthorization(fictionalCandidate, 'US').ok, true);
  assert.equal(validateWorkAuthorization(fictionalCandidate, 'GB').ok, false);
  assert.equal(validateWorkAuthorization(fictionalCandidate, 'us').ok, false);
  assert.equal(validateConsent(defaultApplicationPolicy, 'submit').ok, false);
  assert.equal(validateConsent(defaultApplicationPolicy, 'toString').ok, false);
  assert.equal(validateConsent({ ...defaultApplicationPolicy, consent: { submit: true, marketing: false } }, 'submit').ok, true);
});

// Numbers here are test fixtures, not candidate salary preferences or recommendations.
const salaryPolicy: ApplicationPolicy = {
  ...defaultApplicationPolicy,
  salaryByCountry: { US: { country: 'US', currency: 'USD', period: 'year', basis: 'gross-base', minimum: 100 } },
};
const offer: SalaryOffer = { country: 'US', currency: 'USD', period: 'year', basis: 'gross-base', guaranteedMinimum: 100 };

test('salary requires a configured floor and matching units; no currency conversion', () => {
  assert.deepEqual(defaultApplicationPolicy.salaryByCountry, {});
  assert.equal(validateSalary(defaultApplicationPolicy, offer).ok, false);
  assert.equal(validateSalary(salaryPolicy, offer).ok, true);
  for (const change of [{ guaranteedMinimum: 99 }, { guaranteedMinimum: NaN }, { currency: 'EUR' }, { country: 'GB' }, { period: 'month' as const }]) {
    assert.equal(validateSalary(salaryPolicy, { ...offer, ...change }).ok, false);
  }
  const unset = { ...salaryPolicy, salaryByCountry: { US: { ...salaryPolicy.salaryByCountry.US!, minimum: null } } };
  assert.equal(validateSalary(unset, offer).ok, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import type { BrowserObservation } from '../src/contracts.js';
import { fictionalCandidate, fictionalPersonalData } from '../src/profile.js';
import { BasicPrivacyFilter } from '../src/privacy.js';

export const observation: BrowserObservation = {
  id: 'observation-1', origin: 'http://127.0.0.1:3000', title: 'Application',
  text: 'Welcome Alex Example; alex@example.invalid; other@example.com; +1 202 555 0123',
  controls: [{ id: 'field-1', kind: 'text', label: 'Name of Alex Example', help: 'alex@example.invalid', required: true, options: [] }],
  errors: ['Contact Alex Example'],
};

test('cloud context redacts known personal data and common email/phone patterns without mutation', () => {
  const filtered = new BasicPrivacyFilter().forCloud(observation, fictionalCandidate, fictionalPersonalData);
  const serialized = JSON.stringify(filtered);
  for (const secret of [...Object.values(fictionalPersonalData.references), 'other@example.com', '+1 202 555 0123']) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.match(observation.text, /Alex Example/);
  assert.deepEqual(filtered.personalReferenceIds, ['personal.fullName', 'personal.email']);
  assert.equal(filtered.candidate.facts[0]?.value, 'Software Engineer');
});

test('privacy projection drops unknown raw values and rejects unsafe IDs or URLs', () => {
  const withExtra = { ...observation, rawHtml: '<secret>', value: 'secret' };
  const filter = new BasicPrivacyFilter();
  assert.equal(JSON.stringify(filter.forCloud(withExtra, fictionalCandidate, fictionalPersonalData)).includes('<secret>'), false);
  for (const origin of ['https://example.com', 'http://127.0.0.1:3000/?email=private', 'http://user:pass@127.0.0.1:3000', 'http://127.0.0.1.evil.test:3000']) {
    assert.throws(() => filter.forCloud({ ...observation, origin }, fictionalCandidate, fictionalPersonalData));
  }
  assert.throws(() => filter.forCloud({ ...observation, id: 'alex@example.invalid' }, fictionalCandidate, fictionalPersonalData));
});

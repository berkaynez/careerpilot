import test from 'node:test';
import assert from 'node:assert/strict';
import { careerLevel } from '../src/discovery/level.js';
import { discoveryReasons, defaultDiscoveryConfig } from '../src/discovery/core.js';
import { sourceSearchQueries, sourcesFromSearchURLs } from '../src/discovery/source-search.js';
const job = { externalId: '101', title: 'Software Engineer', text: 'Develop and test software with the team.', location: 'Istanbul', remote: false, url: 'https://job-boards.greenhouse.io/fictional/jobs/101' };

test('early career screening distinguishes explicit minimums, optional qualifications and unknown level', () => {
  for (const title of ['Junior Software Engineer','Software Engineer (New Grad)','Entry-level Data Analyst','Yeni Mezun Yazılım Geliştirici']) assert.equal(careerLevel({ ...job, title }).level, 'entry');
  for (const title of ['Senior Software Engineer','Intermediate Software Engineer','Lead Data Analyst']) {
    assert.equal(careerLevel({ ...job, title }).level, 'experienced'); assert.equal(discoveryReasons({ ...job, title }, defaultDiscoveryConfig).length, 0);
  }
  assert.equal(careerLevel({ ...job, title: 'Junior Software Engineer', text: 'Minimum 5 years of professional experience required.' }).level, 'experienced');
  assert.equal(careerLevel({ ...job, text: 'At least 3 years of experience is preferred.' }).level, 'unclear');
  assert.equal(careerLevel({ ...job, text: 'At least 2 years of experience.' }).level, 'unclear');
  for (const text of ['3+ years in a software engineering role.', 'En az 4 yıl yazılım geliştirme deneyimi.']) assert.equal(careerLevel({...job,text}).level,'experienced');
  assert.equal(careerLevel({...job,text:'0–2 years of experience.'}).level,'entry');
  assert.equal(careerLevel(job).level, 'unclear'); assert.ok(discoveryReasons(job, defaultDiscoveryConfig).some(reason => reason.includes('junior kabul edilmedi')));
  assert.ok(discoveryReasons({ ...job, title: 'Intermediate Software Engineer' }, { ...defaultDiscoveryConfig, earlyCareer: false }).length);
});

test('search drafts cover the configured roles without including an applicant profile or executing requests', () => {
  const roles = ['software engineer','data analyst','business analyst','IT auditor','yazılım geliştirici'];
  const queries = sourceSearchQueries({ roles, locations: ['Turkey','United Kingdom','Remote'] });
  assert.equal(queries.length, 4); for (const role of roles) assert.ok(queries.some(query => query.includes('"' + role + '"')));
  for (const query of queries) { assert.match(query, /site:jobs.lever.co/); assert.match(query, /new grad/); assert.match(query, /Remote/); assert.ok(query.length <= 400); }
  assert.throws(() => sourceSearchQueries({ roles: ['x'.repeat(80),'y'.repeat(80),'z'.repeat(80),'a'.repeat(80),'b'.repeat(80),'c'.repeat(80),'d'.repeat(80),'e'.repeat(80),'f'.repeat(80)], locations: ['x'.repeat(80),'y'.repeat(80),'z'.repeat(80)] }), /DISCOVERY_SEARCH_QUERY_TOO_LONG/);
});

test('bulk source extraction rejects lookalike/private hosts and deduplicates company links without browsing', () => {
  const sources = sourcesFromSearchURLs([
    'https://jobs.lever.co/fictional/00000000-0000-4000-8000-000000000001?tracking=foo',
    'https://jobs.lever.co/fictional', 'https://job-boards.greenhouse.io/another/jobs/123',
    'https://jobs.lever.co.attacker.invalid/evil', 'http://127.0.0.1/secret', 'https://user:secret@jobs.lever.co/private',
    'https://www.linkedin.com/jobs/view/123', 'https://job-boards.greenhouse.io/another/redirect/secret',
  ]);
  assert.equal(sources.length, 2); assert.equal(sources[0]!.board, 'fictional'); assert.equal(sources[1]!.board, 'another');
  assert.ok(sources.every(source => !source.locationFallback));
  assert.throws(() => sourcesFromSearchURLs(Array(101).fill('https://jobs.lever.co/fictional')), /DISCOVERY_SEARCH_RESULTS_LIMIT/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { profileSchema, jobSchema, validatePlan, selectCV, renderPreparation, buildPreparationRequest, planWithModel } from '../src/preparation/core.js';
import { readLocalJSON, writePreparation } from '../src/preparation/files.js';
import { FileBudgetManager } from '../src/persistent-budget.js';
import { InMemoryBudgetManager } from '../src/budget.js';
import type { LLMProvider, ModelConfig } from '../src/llm.js';

const profile = profileSchema.parse({ version: 1,
  contact: { name: 'Synthetic Candidate', email: 'synthetic@example.invalid', phone: '+90 555 111 2233', location: 'Synthetic City' },
  preferences: { countries: ['TR', 'GB'], roles: ['Software', 'IT audit'], authorizedCountries: ['TR'], sponsorshipRequiredElsewhere: true },
  facts: [
    { id: 'education', text: { tr: 'İlgili bir lisans derecem var.', en: 'I hold a relevant undergraduate degree.' }, source: 'fictional fixture' },
    { id: 'project', text: { tr: 'Node.js ile bir akademik projede çalıştım.', en: 'I worked on an academic Node.js project.' }, source: 'fictional fixture' },
  ],
  cvs: [ { id: 'tr-photo', language: 'tr', photo: true, path: '/fictional/tr.pdf' },
    { id: 'en-photo', language: 'en', photo: true, path: '/fictional/en-photo.pdf' },
    { id: 'en-plain', language: 'en', photo: false, path: '/fictional/en-plain.pdf' } ],
});
const job = jobSchema.parse({ version: 1, id: 'example', company: 'Example Company', title: 'Graduate Developer', country: 'TR', language: 'en',
  documentLanguage: null, photoPolicy: 'unspecified', sponsorship: 'not_stated', sourceUrl: 'https://example.invalid/jobs/one', checkedOn: '2026-10-17',
  requirements: [ { id: 'degree', text: 'Relevant degree', priority: 'essential' },
    { id: 'spring', text: 'Spring Boot experience', priority: 'essential' },
    { id: 'backend', text: 'backend service development', priority: 'responsibility' } ],
});
const plan = { assessments: [
  { requirementId: 'degree', evidenceLevel: 'related', factIds: ['education'] },
  { requirementId: 'spring', evidenceLevel: 'not_documented', factIds: [] },
  { requirementId: 'backend', evidenceLevel: 'related', factIds: ['project'] },
], coverLetterFactIds: ['education', 'project'], focusRequirementId: 'backend' };
const model: ModelConfig = { provider: 'offline', model: 'synthetic-model', execution: 'cloud', maxInputTokens: 100, maxOutputTokens: 100,
  pricing: { inputMicroUsdPerMillion: 1_000_000, outputMicroUsdPerMillion: 2_000_000, source: 'synthetic rates', verifiedOn: '2020-01-01' } };
const signal = new AbortController().signal;
const reply = { calls: [{ id: 'offline', name: 'prepare_application', arguments: plan }], usage: { inputTokens: 10, outputTokens: 5 }, usageSource: 'provider' as const };

test('CV selection uses advert language and country, with explicit instructions taking precedence', () => {
  assert.equal(selectCV(profile, job).id, 'en-photo');
  assert.equal(selectCV(profile, { ...job, country: 'GB' }).id, 'en-plain');
  assert.equal(selectCV(profile, { ...job, documentLanguage: 'tr' }).id, 'tr-photo');
  assert.equal(selectCV(profile, { ...job, photoPolicy: 'forbidden' }).id, 'en-plain');
  assert.equal(selectCV(profile, { ...job, country: 'GB', photoPolicy: 'required' }).id, 'en-photo');
  assert.throws(() => selectCV(profile, { ...job, documentLanguage: 'tr', photoPolicy: 'forbidden' }), /PREP_CV_UNAVAILABLE/);
  assert.throws(() => selectCV({ ...profile, cvs: [...profile.cvs, { ...profile.cvs[1]!, id: 'duplicate-choice' }] }, job), /PREP_CV_AMBIGUOUS/);
});

test('profile and job schemas reject ambiguous IDs, unsafe metadata and unsupported language', () => {
  assert.equal(profileSchema.safeParse({ ...profile, facts: [...profile.facts, profile.facts[0]] }).success, false);
  assert.equal(profileSchema.safeParse({ ...profile, cvs: [{ ...profile.cvs[0], path: 'relative.pdf' }] }).success, false);
  assert.equal(jobSchema.safeParse({ ...job, company: 'Company\nForged heading' }).success, false);
  assert.equal(jobSchema.safeParse({ ...job, sourceUrl: 'https://secret@example.invalid/' }).success, false);
  assert.equal(jobSchema.safeParse({ ...job, language: 'unknown' }).success, false);
});

test('reviews must cover each requirement once and cannot invent evidence or arbitrary letter text', () => {
  assert.deepEqual(validatePlan(plan, profile, job), plan);
  const invalid = [
    { ...plan, assessments: plan.assessments.slice(1) },
    { ...plan, assessments: [...plan.assessments, plan.assessments[0]] },
    { ...plan, assessments: [{ requirementId: 'degree', evidenceLevel: 'documented', factIds: ['invented'] }, ...plan.assessments.slice(1)] },
    { ...plan, assessments: [{ requirementId: 'degree', evidenceLevel: 'not_documented', factIds: ['education'] }, ...plan.assessments.slice(1)] },
    { ...plan, coverLetterFactIds: ['invented'] }, { ...plan, coverLetterFactIds: ['education', 'education'] },
    { ...plan, focusRequirementId: 'invented' }, { ...plan, coverLetter: 'I have ten years of Spring experience' },
  ];
  for (const raw of invalid) assert.throws(() => validatePlan(raw, profile, job), /PREP_PLAN_INVALID/);
});

test('preparation keeps documented gaps and uses only selected profile statements in the letter', () => {
  const result = renderPreparation(profile, job, plan, 'local_review');
  assert.equal(result.status, 'draft_requires_review');
  assert.match(result.report, /Spring Boot experience.*Profilde belgelenmiyor/);
  assert.match(result.coverLetter, /academic Node.js project/);
  assert.doesNotMatch(result.coverLetter, /Spring Boot/);
  assert.equal(result.requiresSponsorship, false);
  const abroad = renderPreparation(profile, { ...job, country: 'GB', sponsorship: 'unavailable' }, plan, 'local_review');
  assert.equal(abroad.requiresSponsorship, true);
  assert.match(abroad.report, /İlan sponsorluğu dışlıyor/);
  assert.equal(abroad.cv.id, 'en-plain');
});

test('cloud context excludes contact details, local CV paths and evidence source paths', () => {
  const hostileJob = { ...job, company: profile.contact.email, title: profile.contact.name };
  const request = buildPreparationRequest(profile, hostileJob, model);
  const sent = JSON.stringify(request);
  for (const privateValue of [...Object.values(profile.contact), '/fictional/', 'fictional fixture']) assert.ok(!sent.includes(privateValue));
  assert.ok(sent.includes('[PRIVATE]'));
  assert.equal(request.tools[0]?.inputSchema.additionalProperties, false);
});

test('model preparation needs fresh paid-call AND cloud-profile consent before any reservation or request', async () => {
  let calls = 0;
  const provider: LLMProvider = { id: 'offline', async generate() { calls++; return reply; } };
  const budget = new InMemoryBudgetManager();
  for (const consent of [{ paidCallApproved: false, cloudProfileApproved: true }, { paidCallApproved: true, cloudProfileApproved: false }]) {
    await assert.rejects(planWithModel(profile, job, { ...consent, model, provider, budget, runId: 'consent' }, signal), /PREP_MODEL_CONSENT_REQUIRED/);
  }
  assert.equal(calls, 0); assert.equal(budget.snapshot().reservedMicroUsd, 0);
  assert.deepEqual(await planWithModel(profile, job, { paidCallApproved: true, cloudProfileApproved: true, model, provider, budget, runId: 'approved' }, signal), plan);
  assert.equal(calls, 1); assert.equal(budget.runAccounting('approved').costMicroUsd, 20);
});

test('provider failure retains durable reservations and a budget stop prevents requests', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'careerpilot-prep-budget-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const ledger = join(dir, 'budget.jsonl'); let calls = 0;
  const provider: LLMProvider = { id: 'offline', async generate() { calls++; throw new Error('PROVIDER_NETWORK_ERROR'); } };
  const options = { provider, model, runId: 'uncertain', paidCallApproved: true, cloudProfileApproved: true };
  await assert.rejects(planWithModel(profile, job, { ...options, budget: new FileBudgetManager(ledger) }, signal), /PROVIDER_NETWORK_ERROR/);
  assert.equal(new FileBudgetManager(ledger).snapshot().reservedMicroUsd, 300);
  await assert.rejects(planWithModel(profile, job, { ...options, budget: new FileBudgetManager(join(dir, 'low.jsonl'), 100) }, signal), /BUDGET_MONTHLY_STOP/);
  assert.equal(calls, 1);
});

test('invalid model decisions are billed once and are not retried', async () => {
  let calls = 0; const budget = new InMemoryBudgetManager();
  const provider: LLMProvider = { id: 'offline', async generate() { calls++; return { ...reply, calls: [{ ...reply.calls[0]!, name: 'submit_application' }] }; } };
  await assert.rejects(planWithModel(profile, job, { provider, model, budget, runId: 'invalid', paidCallApproved: true, cloudProfileApproved: true }, signal), /PREP_MODEL_RESPONSE_INVALID/);
  assert.equal(calls, 1); assert.equal(budget.runAccounting('invalid').costMicroUsd, 20);
});

test('local packet copies the exact CV, uses private permissions, and refuses overwrite or non-PDF assets', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'careerpilot-prep-files-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cvPath = join(dir, 'resume.pdf'); const cv = Buffer.from('%PDF-1.4\nsynthetic test fixture');
  await writeFile(cvPath, cv);
  const local = { ...profile, cvs: profile.cvs.map(asset => ({ ...asset, path: cvPath })) };
  const dest = join(dir, 'packet');
  await writePreparation(dest, local, job, plan, 'local_review');
  assert.deepEqual(await readFile(join(dest, 'resume.pdf')), cv);
  assert.match(await readFile(join(dest, 'cover-letter.txt'), 'utf8'), /Synthetic Candidate/);
  assert.doesNotMatch(await readFile(join(dest, 'preparation.json'), 'utf8'), /synthetic@example|\/fictional\//);
  assert.equal((await stat(dest)).mode & 0o777, 0o700);
  assert.equal((await stat(join(dest, 'cover-letter.txt'))).mode & 0o777, 0o600);
  await assert.rejects(writePreparation(dest, local, job, plan, 'local_review'));
  await writeFile(cvPath, 'not a PDF');
  await assert.rejects(writePreparation(join(dir, 'bad'), local, job, plan, 'local_review'), /PREP_CV_INVALID/);
  const linked = join(dir, 'linked.json'); await symlink(cvPath, linked);
  await assert.rejects(readLocalJSON(linked));
});

test('CLI runs a complete local review without API configuration and refuses implicit cloud consent', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'careerpilot-prep-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cvPath = join(dir, 'resume.pdf'); await writeFile(cvPath, '%PDF-1.4\nsynthetic test fixture');
  const local = { ...profile, cvs: profile.cvs.map(asset => ({ ...asset, path: cvPath })) };
  for (const [name, value] of Object.entries({ profile: local, job, review: plan })) await writeFile(join(dir, name+'.json'), JSON.stringify(value));
  const exec = promisify(execFile);
  const args = ['--import', 'tsx', 'src/preparation/cli.ts', '--profile', join(dir, 'profile.json'), '--job', join(dir, 'job.json')];
  const env = { ...process.env, CAREERPILOT_STATE_DIR: join(dir, 'state'), CAREERPILOT_ENABLE_PAID_CALLS: 'false' };
  const result = await exec(process.execPath, [...args, '--review', join(dir, 'review.json')], { env });
  const metadata = JSON.parse(result.stdout);
  assert.equal(metadata.status, 'draft_requires_review');
  assert.match(await readFile(join(metadata.directory, 'review.txt'), 'utf8'), /bu işlemde model çağrısı yok/);
  await assert.rejects(exec(process.execPath, [...args, '--model'], { env }), error => {
    assert.match(String((error as { stderr?: string }).stderr), /PREP_MODEL_CONSENT_REQUIRED/); return true;
  });
});

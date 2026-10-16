import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PlaywrightBrowserExecutor } from '../src/browser/executor.js';
import { startMockServer } from '../src/mocks/server.js';
import type { ApplicationKind } from '../src/mocks/forms.js';
import { fictionalCandidate, fictionalPersonalData } from '../src/profile.js';
import { defaultApplicationPolicy } from '../src/policy.js';
import { BasicPrivacyFilter } from '../src/privacy.js';
import type { BrowserAction, BrowserObservation, FormControl, AgentEvent } from '../src/contracts.js';

const signal = new AbortController().signal;
const consent = { 'application.accuracy': true, 'application.submit': true };
const candidate = fictionalCandidate;

function control(observation: BrowserObservation, label: string): FormControl {
  const found = observation.controls.find(item => item.label === label);
  assert.ok(found, `Missing visible control: ${label}`);
  return found;
}

async function perform(session: PlaywrightBrowserExecutor, label: string | null, build: (elementId: string, observation: BrowserObservation) => BrowserAction) {
  const observation = await session.observe(signal);
  const id = label === null ? '' : control(observation, label).id;
  const results = await session.execute({ kind: 'action', observationId: observation.id, action: build(id, observation) }, signal);
  assert.equal(results[0]?.status, 'executed', JSON.stringify(results));
  return results;
}
const fillFact = (session: PlaywrightBrowserExecutor, label: string, factId: string) => perform(session, label, elementId => ({
  kind: 'fill', elementId, answer: { kind: 'fact', claim: { factId, value: candidate.facts.find(fact => fact.id === factId)!.value } },
}));
const fillPersonal = (session: PlaywrightBrowserExecutor, label: string, referenceId: string) => perform(session, label, elementId => ({
  kind: 'fill', elementId, answer: { kind: 'personal-reference', referenceId },
}));
const click = (session: PlaywrightBrowserExecutor, label: string) => perform(session, label, elementId => ({ kind: 'click', elementId }));
const select = (session: PlaywrightBrowserExecutor, label: string, factId: string) => perform(session, label, (elementId, observation) => {
  const fact = candidate.facts.find(item => item.id === factId)!;
  const option = control(observation, label).options.find(item => item.label === fact.value)!;
  return { kind: 'select', elementId, optionId: option.id, claim: { factId, value: fact.value } };
});

async function setup(t: TestContext, kind: ApplicationKind) {
  const server = await startMockServer();
  const runId = `${kind}-${Date.now()}`;
  const events: AgentEvent[] = [];
  let session: PlaywrightBrowserExecutor | undefined;
  t.after(async () => { await session?.close(); await server.close(); });
  session = await PlaywrightBrowserExecutor.create({
    runId, applicationUrl: `${server.origin}/applications/${kind}`, candidate, personal: fictionalPersonalData,
    policy: { ...defaultApplicationPolicy, allowedOrigin: server.origin, consent }, events: { async write(event) { events.push(event); } },
  });
  return { session, server, runId, events };
}

async function contact(session: PlaywrightBrowserExecutor) {
  await fillPersonal(session, 'Full name', 'personal.fullName');
  await fillPersonal(session, 'Email address', 'personal.email');
}
async function qualifications(session: PlaywrightBrowserExecutor) {
  await fillFact(session, 'School or university', 'education.school');
  await select(session, 'Highest qualification', 'education.degree');
  await fillFact(session, 'Most recent job title', 'experience.role');
  await fillFact(session, 'Describe a relevant project', 'experience.project');
}
async function submit(session: PlaywrightBrowserExecutor) {
  await perform(session, 'I confirm these fictional application details are accurate', elementId => ({
    kind: 'check', elementId, checked: true, evidence: { kind: 'consent', consentId: 'application.accuracy' },
  }));
  await perform(session, 'Submit mock application', elementId => ({ kind: 'submit', elementId, consentId: 'application.submit' }));
}

test('inspector and executor complete single page with local references and independently verified receipt', async t => {
  const { session, server, runId, events } = await setup(t, 'single');
  const observation = await session.observe(signal);
  assert.equal(control(observation, 'Email address').inputType, 'email');
  assert.equal(control(observation, 'Full name').required, true);
  assert.equal(control(observation, 'Submit mock application').buttonEffect, 'submission');
  assert.match(control(observation, 'Describe a relevant project').help, /truthful/);
  assert.ok(!observation.controls.some(item => item.inputType === 'hidden'));
  assert.equal(await server.verify(runId, signal), null);
  // Clicking an invalid form is not submission success.
  await perform(session, 'Submit mock application', elementId => ({ kind: 'submit', elementId, consentId: 'application.submit' }));
  assert.ok((await session.observe(signal)).errors.length);
  assert.equal(await server.verify(runId, signal), null);
  await contact(session); await qualifications(session);
  const filled = await session.observe(signal);
  assert.equal(JSON.stringify(filled.controls).includes('alex@example.invalid'), false);
  assert.ok(new BasicPrivacyFilter().forCloud(filled, candidate, fictionalPersonalData));
  await submit(session);
  const receipt = await server.verify(runId, signal);
  assert.ok(receipt);
  assert.match((await session.observe(signal)).text, new RegExp(receipt.receiptId));
  assert.equal(await server.verify('different-run', signal), null);
  assert.ok(events.length > 0);
  assert.equal(JSON.stringify(events).includes('alex@example.invalid'), false);
});

test('multi-step form validates navigation, preserves answers when going back, and exposes review', async t => {
  const { session, server, runId } = await setup(t, 'multi');
  assert.ok(!(await session.observe(signal)).controls.some(item => item.label === 'School or university'));
  await click(session, 'Continue to qualifications');
  assert.ok((await session.observe(signal)).errors.length);
  await contact(session); await click(session, 'Continue to qualifications');
  await qualifications(session); await click(session, 'Review application');
  assert.match((await session.observe(signal)).text, /Example Institute/);
  await click(session, 'Back to qualifications');
  await click(session, 'Back to contact');
  await click(session, 'Continue to qualifications');
  await click(session, 'Review application');
  assert.match((await session.observe(signal)).text, /alex@example.invalid/);
  assert.equal(await server.verify(runId, signal), null);
  await submit(session);
  assert.ok(await server.verify(runId, signal));
});

test('dynamic form reinspects after conditional batch, waits for delayed controls, and fills repeatable history', async t => {
  const { session, server, runId } = await setup(t, 'dynamic');
  const initial = await session.observe(signal);
  assert.ok(!initial.controls.some(item => item.label === 'Current employer'));
  const status = control(initial, 'Current employment status');
  const employment = candidate.facts.find(fact => fact.id === 'experience.employmentStatus')!;
  const batch = await session.execute({ kind: 'batch', observationId: initial.id, actions: [
    { kind: 'select', elementId: status.id, optionId: status.options.find(item => item.label === employment.value)!.id, claim: { factId: employment.id, value: employment.value } },
    { kind: 'fill', elementId: control(initial, 'Full name').id, answer: { kind: 'personal-reference', referenceId: 'personal.fullName' } },
  ] }, signal);
  assert.equal(batch.length, 1);
  assert.equal(batch[0]?.code, 'BATCH_REINSPECT_REQUIRED');
  assert.ok(control(await session.observe(signal), 'Current employer').required);
  await contact(session); await fillFact(session, 'Current employer', 'experience.company');
  await fillFact(session, 'Job title 1', 'experience.role'); await fillFact(session, 'Employer 1', 'experience.company');
  await click(session, 'Add work history');
  await fillFact(session, 'Job title 2', 'experience.role'); await fillFact(session, 'Employer 2', 'experience.company');
  await click(session, 'Show project question');
  await perform(session, null, () => ({ kind: 'wait' }));
  await fillFact(session, 'Describe a relevant project', 'experience.project');
  await submit(session);
  assert.ok(await server.verify(runId, signal));
});

test('executor rejects stale observations, absent consent, unsupported facts, and pre-aborted actions', async t => {
  const { session } = await setup(t, 'single');
  const old = await session.observe(signal);
  await session.observe(signal);
  assert.equal((await session.execute({ kind: 'action', observationId: old.id, action: { kind: 'wait' } }, signal))[0]?.status, 'rejected');
  const observation = await session.observe(signal);
  assert.equal((await session.execute({ kind: 'action', observationId: observation.id, action: {
    kind: 'fill', elementId: control(observation, 'Full name').id, answer: { kind: 'fact', claim: { factId: 'invented', value: 'invented' } },
  } }, signal))[0]?.status, 'rejected');
  assert.equal((await session.execute({ kind: 'action', observationId: observation.id, action: {
    kind: 'submit', elementId: control(observation, 'Submit mock application').id, consentId: 'not-granted',
  } }, signal))[0]?.status, 'rejected');
  const aborted = AbortSignal.abort();
  assert.equal((await session.execute({ kind: 'action', observationId: observation.id, action: { kind: 'wait' } }, aborted))[0]?.code, 'ABORTED');
});

async function fixture(t: TestContext, handler: (request: IncomingMessage, response: ServerResponse) => void, onConnection?: () => void): Promise<string> {
  const server = createServer(handler);
  if (onConnection) server.on('connection', onConnection);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  return `http://127.0.0.1:${address.port}`;
}
async function fixtureSession(t: TestContext, origin: string) {
  const session = await PlaywrightBrowserExecutor.create({ runId: 'security-test', applicationUrl: origin, candidate,
    personal: fictionalPersonalData, policy: { ...defaultApplicationPolicy, allowedOrigin: origin, consent } });
  t.after(() => session.close());
  return session;
}

test('context blocks off-origin fetches, resources, redirects, sockets, and popups without contacting destination', async t => {
  let destinationHits = 0;
  let redirectHits = 0;
  const destination = await fixture(t, (_, response) => { response.end('should never be requested'); }, () => { destinationHits++; });
  const origin = await fixture(t, (request, response) => {
    if (request.url === '/redirect') { redirectHits++; response.writeHead(302, { location: destination }); response.end(); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<h1>Network guard fixture</h1><button type="button" onclick="attack()">Attempt traffic</button>
      <script>function attack(){fetch('${destination}/fetch').catch(()=>{});fetch('/redirect').catch(()=>{});
      const image=new Image();image.src='${destination}/image';document.body.append(image);
      new WebSocket('${destination.replace('http:', 'ws:')}/socket');window.open('${destination}/popup');}</script>`);
  });
  const session = await fixtureSession(t, origin);
  // Trigger hostile local fixture code directly via an ordinary navigation action.
  const observation = await session.observe(signal);
  await session.execute({ kind: 'action', observationId: observation.id, action: { kind: 'click', elementId: control(observation, 'Attempt traffic').id } }, signal);
  const fresh = await session.observe(signal);
  await session.execute({ kind: 'action', observationId: fresh.id, action: { kind: 'wait' } }, signal);
  assert.equal(destinationHits, 0);
  assert.equal(redirectHits, 1);
  assert.equal((await session.observe(signal)).origin, origin);
});

test('off-origin links and form submissions are rejected before execution', async t => {
  let hits = 0;
  const destination = await fixture(t, (_, response) => { hits++; response.end(); });
  const origin = await fixture(t, (_, response) => { response.setHeader('Content-Type', 'text/html'); response.end(
    `<a href="${destination}">External navigation</a><form method="post" action="${destination}"><button>External submission</button></form>`); });
  const session = await fixtureSession(t, origin);
  const observation = await session.observe(signal);
  for (const action of [
    { kind: 'click' as const, elementId: control(observation, 'External navigation').id },
    { kind: 'submit' as const, elementId: control(observation, 'External submission').id, consentId: 'application.submit' },
  ]) assert.equal((await session.execute({ kind: 'action', observationId: observation.id, action }, signal))[0]?.status, 'rejected');
  assert.equal(hits, 0);
});

test('input handlers cannot submit without a submit action; browser contexts have no shared storage', async t => {
  let posts = 0;
  const origin = await fixture(t, (request, response) => {
    if (request.method === 'POST') { posts++; response.end('unexpected'); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<h1 id="storage"></h1><label>Name<input oninput="fetch('/side-effect',{method:'POST',body:'runId=security-test'}).catch(()=>{})"></label>
      <script>document.querySelector('#storage').textContent=localStorage.getItem('previous')||'Fresh context';localStorage.setItem('previous','Leaked storage');</script>`);
  });
  const first = await fixtureSession(t, origin);
  const observation = await first.observe(signal);
  await first.execute({ kind: 'action', observationId: observation.id, action: {
    kind: 'fill', elementId: control(observation, 'Name').id, answer: { kind: 'personal-reference', referenceId: 'personal.fullName' },
  } }, signal);
  await perform(first, null, () => ({ kind: 'wait' }));
  assert.equal(posts, 0);
  const second = await fixtureSession(t, origin);
  assert.match((await second.observe(signal)).text, /Fresh context/);
});

test('script-driven top-level navigation cannot reach another loopback origin', async t => {
  let connections = 0;
  const destination = await fixture(t, (_, response) => response.end('not allowed'), () => { connections++; });
  const origin = await fixture(t, (_, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<button type="button" onclick="location.href='${destination}/escape'">Attempt navigation</button>`);
  });
  const session = await fixtureSession(t, origin);
  const observation = await session.observe(signal);
  const result = await session.execute({ kind: 'action', observationId: observation.id, action: {
    kind: 'click', elementId: control(observation, 'Attempt navigation').id,
  } }, signal);
  assert.equal(connections, 0);
  assert.ok(result.some(item => item.status !== 'executed'));
});

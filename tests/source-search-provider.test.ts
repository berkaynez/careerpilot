import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSourceSearch } from '../src/discovery/search-provider.js';
import { startHub } from '../src/hub/server.js';
import { demoProfile } from '../src/hub/demo.js';
const criteria = { roles: ['software engineer'], locations: ['Turkey'] };
const account = { account_status: 'Active', plan_monthly_price: 0, total_searches_left: 250, account_rate_limit_per_hour: 50, this_hour_searches: 0 };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const result = { search_metadata: { status: 'Success' }, organic_results: [{ link: 'https://jobs.lever.co/fictional' }, { link: 'https://127.0.0.1/secret' }] };

test('search sends criteria only to fixed service, caches sources across restart and never persists account secrets', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'careerpilot-search-')); t.after(() => rm(dir, { recursive: true, force: true }));
  let calls = 0;
  const request: typeof fetch = async (input, init) => {
    calls++; const url = new URL(String(input)); assert.equal(url.origin, 'https://serpapi.com'); assert.equal(url.searchParams.get('api_key'), 'fictional-secret');
    assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit');
    assert.ok(!url.href.includes(demoProfile.contact.email));
    if (url.pathname === '/account.json') return json({ ...account, api_key: 'fictional-secret', account_email: 'private@example.invalid' });
    assert.match(url.searchParams.get('q')!, /software engineer/); return json(result);
  };
  const service = await openSourceSearch(dir, 'fictional-secret', request);
  const ready = await service.status(criteria); assert.equal(calls,0); assert.equal(ready.remainingToday,8); assert.equal(ready.waitSeconds,0);
  const first = await service.run(criteria, new AbortController().signal); assert.equal(first.sources.length, 1); assert.equal(first.requests, 1); assert.equal(first.cached, false); assert.equal(calls, 2);
  const reopened = await openSourceSearch(dir, 'fictional-secret', request);
  const status = await reopened.status(criteria); assert.equal(status.cached,true); assert.equal(status.remainingToday,7); assert.ok(status.waitSeconds > 0); assert.equal(calls,2);
  const cached = await reopened.run(criteria, new AbortController().signal);
  assert.deepEqual(cached.rejectionReasons, first.rejectionReasons);
  assert.equal(Object.values(first.rejectionReasons).reduce((a,b)=>a+b,0), first.rejected); assert.equal(cached.requests, 0); assert.equal(cached.cached, true); assert.equal(calls, 2);
  const disk = await readFile(join(dir, 'source-search.json'), 'utf8'); assert.ok(!disk.includes('fictional-secret')); assert.ok(!disk.includes('private@example.invalid'));
});

test('paid/unknown plans and exhausted free quota cannot trigger search calls', async t => {
  for (const response of [{ ...account, plan_monthly_price: 25 }, { ...account, plan_monthly_price: undefined }, { ...account, total_searches_left: 0 }]) {
    const dir = await mkdtemp(join(tmpdir(), 'careerpilot-free-plan-')); t.after(() => rm(dir, { recursive: true, force: true })); let calls = 0;
    const service = await openSourceSearch(dir, 'secret', async input => { calls++; assert.equal(new URL(String(input)).pathname, '/account.json'); return json(response); });
    await assert.rejects(service.run(criteria, new AbortController().signal), /DISCOVERY_SEARCH_(FREE_PLAN_REQUIRED|QUOTA_STOP)/); assert.equal(calls, 1);
  }
});

test('uncertain search failures retain reservations and cooldown after restart without retries', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'careerpilot-search-error-')); t.after(() => rm(dir, { recursive: true, force: true })); let searches = 0;
  const request: typeof fetch = async input => { if (new URL(String(input)).pathname === '/account.json') return json(account); searches++; throw new Error('secret must not escape'); };
  const service = await openSourceSearch(dir, 'secret', request);
  await assert.rejects(service.run(criteria, new AbortController().signal), /^Error: DISCOVERY_SEARCH_NETWORK$/); assert.equal(searches, 1);
  const state = JSON.parse(await readFile(join(dir, 'source-search.json'), 'utf8')); assert.equal(state.attempts.length, 1);
  await assert.rejects((await openSourceSearch(dir, 'secret', request)).run(criteria, new AbortController().signal), /DISCOVERY_SEARCH_COOLDOWN/); assert.equal(searches, 1);
});

test('daily quota, rate limits and oversized bodies stop search without automatic retries', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'careerpilot-search-limit-')); t.after(() => rm(dir, { recursive: true, force: true }));
  let clock = new Date('2026-10-19T01:00:00Z'), searches = 0;
  const service = await openSourceSearch(dir, 'secret', async input => { if (new URL(String(input)).pathname === '/account.json') return json(account); searches++; return json(result); }, () => clock);
  const four = { ...criteria, roles: ['developer','analyst','engineer','auditor'] };
  await service.run(four, new AbortController().signal); clock = new Date('2026-10-19T02:00:00Z');
  await service.run({ ...four, locations: ['UK'] }, new AbortController().signal); clock = new Date('2026-10-19T03:00:00Z');
  await assert.rejects(service.run(criteria, new AbortController().signal), /DISCOVERY_SEARCH_QUOTA_STOP/); assert.equal(searches, 8);
  const monthDir = await mkdtemp(join(tmpdir(), 'careerpilot-search-month-')); t.after(() => rm(monthDir, { recursive: true, force: true }));
  await writeFile(join(monthDir, 'source-search.json'), JSON.stringify({ version: 1, attempts: Array(200).fill('2026-10-01T01:00:00Z'), cache: null }));
  const capped = await openSourceSearch(monthDir, 'secret', async () => { throw new Error('must not call provider'); }, () => clock);
  await assert.rejects(capped.run(criteria, new AbortController().signal), /DISCOVERY_SEARCH_QUOTA_STOP/);
  for (const mode of ['rate','large']) {
    const next = await mkdtemp(join(tmpdir(), 'careerpilot-search-response-')); t.after(() => rm(next, { recursive: true, force: true })); let calls = 0;
    const provider = await openSourceSearch(next, 'secret', async input => { if (new URL(String(input)).pathname === '/account.json') return json(account); calls++;
      return mode === 'rate' ? new Response('', { status: 429 }) : new Response(new Uint8Array(2_000_001), { headers: { 'Content-Type': 'application/json' } }); });
    await assert.rejects(provider.run(criteria, new AbortController().signal), new RegExp(mode === 'rate' ? 'DISCOVERY_SEARCH_RATE_LIMITED' : 'DISCOVERY_SEARCH_RESPONSE_TOO_LARGE')); assert.equal(calls, 1);
  }
});

test('panel source search requires trusted origin, token and explicit criteria-sharing consent', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'careerpilot-search-hub-')); let calls = 0;
  const sourceSearch = await openSourceSearch(join(dir, 'search'), 'secret', async input => { calls++; return json(new URL(String(input)).pathname === '/account.json' ? account : result); });
  const hub = await startHub({ directory: join(dir, 'jobs'), profile: demoProfile, sourceSearch,
    discoveryReader: async () => ({ rejected: 0, jobs: [{ externalId: '00000000-0000-4000-8000-000000000001', title: 'Junior Software Engineer', text: 'Build and test fictional software with the team.', location: 'Turkey', remote: false, url: 'https://jobs.lever.co/fictional/00000000-0000-4000-8000-000000000001' }] }) });
  t.after(async () => { await hub.close(); await rm(dir, { recursive: true, force: true }); });
  const session = await (await fetch(hub.origin + '/api/session')).json();
  const send = (approved: boolean, origin = hub.origin) => fetch(hub.origin + '/api/discovery/source-search', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Hub-Token': session.token }, body: JSON.stringify({ approved }) });
  assert.equal((await send(true, 'https://attacker.invalid')).status, 403); assert.equal((await send(false)).status, 400); assert.equal(calls, 0);
  const response = await send(true); assert.equal(response.status, 200); const data = await response.json(); assert.equal(data.sources.length, 1); assert.equal(data.modelCalls, 0);
  assert.ok(!JSON.stringify(data).includes('secret')); assert.equal((await (await fetch(hub.origin + '/api/jobs', { headers: { 'X-Hub-Token': session.token } })).json()).length, 0);
  const headers = { Origin: hub.origin, 'Content-Type': 'application/json', 'X-Hub-Token': session.token };
  const saved = await (await fetch(hub.origin + '/api/discovery', { headers })).json();
  assert.equal((await fetch(hub.origin + '/api/discovery/config', { method: 'POST', headers, body: JSON.stringify({ ...saved.config, sources: data.sources }) })).status, 200);
  const imported = await (await fetch(hub.origin + '/api/discovery/run', { method: 'POST', headers, body: '{}' })).json(); assert.equal(imported.added, 1);
  const jobs = await (await fetch(hub.origin + '/api/jobs', { headers })).json(); assert.equal(jobs[0].state, 'review'); assert.equal(jobs[0].discovery.routingConfirmed, false); assert.equal(jobs[0].score, null);

});


test('a later timeout preserves completed source results across restart without retrying unfinished queries', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'careerpilot-search-partial-')); t.after(() => rm(dir, {recursive:true,force:true})); let searches = 0;
  const request: typeof fetch = async input => {
    if (new URL(String(input)).pathname === '/account.json') return json(account);
    searches++; if (searches === 2) throw new DOMException('timeout', 'TimeoutError'); return json(result);
  };
  const multiple = { ...criteria, roles: ['developer','analyst','engineer'] };
  const first = await (await openSourceSearch(dir, 'secret', request)).run(multiple,new AbortController().signal);
  assert.equal(first.partial,true); assert.equal(first.failureCode,'DISCOVERY_SEARCH_TIMEOUT'); assert.equal(first.sources.length,1); assert.equal(first.requests,2); assert.equal(searches,2);
  const cached = await (await openSourceSearch(dir, 'secret', request)).run(multiple,new AbortController().signal);
  assert.equal(cached.partial,true); assert.equal(cached.cached,true); assert.equal(cached.requests,0); assert.equal(searches,2);
  const state = JSON.parse(await readFile(join(dir,'source-search.json'),'utf8')); assert.equal(state.attempts.length,2);
});

test('legacy cached results preserve unknown rejection counts without resetting quota or calling provider', async t => {
  const dir=await mkdtemp(join(tmpdir(),'careerpilot-legacy-search-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const service=await openSourceSearch(dir,'secret',async input=>json(new URL(String(input)).pathname==='/account.json'?account:result));
  await service.run(criteria,new AbortController().signal);
  const file=join(dir,'source-search.json'), state=JSON.parse(await readFile(file,'utf8'));
  delete state.cache.rejectionReasons; state.cache.rejected=7;
  await writeFile(file,JSON.stringify(state));
  const reopened=await openSourceSearch(dir,'secret',async()=>{throw new Error('must not request');});
  const cached=await reopened.run(criteria,new AbortController().signal);
  assert.equal(cached.rejected,7); assert.equal(Object.values(cached.rejectionReasons).reduce((a,b)=>a+b,0),0);
  assert.equal((await reopened.status(criteria)).remainingToday,7);
});

test('saved job-search summary survives restart and expiry without requests, reservations or imports', async t => {
  const dir=await mkdtemp(join(tmpdir(),'careerpilot-saved-summary-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  let clock=new Date('2026-10-19T10:00:00Z'), calls=0;
  const jobCriteria={...criteria,mode:'jobs' as const};
  const request: typeof fetch=async input=>{
    calls++; if(new URL(String(input)).pathname==='/account.json') return json(account);
    return json({search_metadata:{status:'Success'},organic_results:[
      {link:'https://www.linkedin.com/jobs/view/123',title:'Junior Software Engineer'},
      {link:'https://tr.linkedin.com/jobs/view/123?tracking=remove',title:'Junior Software Engineer'},
      {link:'https://jobs.lever.co/fictional',title:'Company jobs'},
    ]});
  };
  const first=await openSourceSearch(dir,'secret',request,()=>clock);
  await first.run(jobCriteria,new AbortController().signal); assert.equal(calls,2);
  const reopened=await openSourceSearch(dir,'secret',async()=>{throw new Error('must not request');},()=>clock);
  const before=await readFile(join(dir,'source-search.json'),'utf8');
  const ready=await reopened.status(jobCriteria), report=ready.lastResult!;
  assert.equal(report.examined,3); assert.equal(report.uniqueLinks,1); assert.equal(report.repeatedLinks,1);
  assert.equal(report.rejected,1); assert.equal(report.rejectionReasons.listingPage,1); assert.equal(report.partial,false);
  assert.equal((await reopened.status({...jobCriteria,roles:['data analyst']})).lastResult,null);
  clock=new Date('2026-10-21T10:00:00Z');
  const expired=await reopened.status(jobCriteria); assert.equal(expired.cached,false); assert.deepEqual(expired.lastResult,report);
  assert.equal(await readFile(join(dir,'source-search.json'),'utf8'),before); assert.equal(calls,2);
});

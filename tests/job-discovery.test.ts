import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { roleProfiles } from '../src/discovery/role-profiles.js';
import { jobSearchQueries } from '../src/discovery/source-search.js';
import { searchHits, importSearchJobs } from '../src/discovery/job-results.js';
import { defaultDiscoveryConfig } from '../src/discovery/core.js';
import { openHubStore } from '../src/hub/store.js';
import { startHub } from '../src/hub/server.js';
import { openSourceSearch } from '../src/discovery/search-provider.js';
import { demoProfile } from '../src/hub/demo.js';
const query = 'fictional job search';
const rows = [
  {link:'https://tr.linkedin.com/jobs/view/junior-software-engineer-1234567890?tracking=remove',title:'Junior Software Engineer at Fictional One',snippet:'Develop fictional software in Istanbul.'},
  {link:'https://www.linkedin.com/jobs/view/1234567890',title:'Junior Software Engineer at Fictional One',snippet:'Duplicate index listing.'},
  {link:'https://tr.indeed.com/viewjob?jk=0123456789abcdef',title:'Junior Data Analyst at Fictional Two',snippet:'Analyse fictional datasets in Turkey.'},
  {link:'https://www.kariyer.net/is-ilani/fictional-junior-developer-1234567',title:'Junior Developer at Fictional Three',snippet:'Build fictional user interfaces.'},
];
const json = (value: unknown) => new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});

test('two role queries cover configured roles and job sites without requiring company boards; location scopes remain separate', () => {
  const queries = jobSearchQueries({roles:defaultDiscoveryConfig.roles,locations:['Türkiye','Turkey','Istanbul']}); assert.equal(queries.length,2);
  for (const role of defaultDiscoveryConfig.roles) assert.ok(queries.some(q=>q.includes('"'+role+'"')));
  for (const q of queries) { assert.match(q,/linkedin\.com/); assert.match(q,/indeed\.com/); assert.match(q,/kariyer\.net/); assert.ok(q.length<=400); assert.ok(!q.includes('Remote')); }
  assert.match(jobSearchQueries({roles:['developer'],locations:['Remote']})[0]!,/Remote/);
  assert.ok(!jobSearchQueries({roles:['developer'],locations:['Turkey'],earlyCareer:false})[0]!.includes('junior'));
});

test('direct results accept supported posting URLs, remove tracking, reject non-job/private/unsafe targets and preserve text as data', () => {
  const parsed = searchHits([...rows,{link:'https://jobs.lever.co/fictional',title:'Company home'}, {link:'https://127.0.0.1/private',title:'Private'},
    {link:'https://www.linkedin.com.attacker.invalid/jobs/view/123',title:'Bad'}, {link:'javascript:alert(1)',title:'Bad'}],query);
  assert.equal(parsed.hits.length,4); assert.equal(parsed.rejected,4);
  assert.equal(parsed.hits[0]!.url,'https://www.linkedin.com/jobs/view/1234567890'); assert.equal(parsed.hits[0]!.url,parsed.hits[1]!.url);
  assert.ok(!JSON.stringify(parsed.hits).includes('tracking=remove'));
});

test('direct imports deduplicate across statuses and restarts without pretending search snippets prove country, company or full requirements', async t => {
  const dir=await mkdtemp(join(tmpdir(),'careerpilot-job-import-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=await openHubStore(dir,demoProfile), hits=searchHits(rows,query).hits;
  const first=await importSearchJobs(store,hits,defaultDiscoveryConfig); assert.equal(first.added,3); assert.equal(first.duplicates,1);
  const record=store.list()[0]!; assert.equal(record.state,'review'); assert.equal(record.posting.country,'ZZ'); assert.equal(record.posting.company,'Şirket doğrulanmalı'); assert.equal(record.discovery?.search?.verified,false); assert.equal(record.analysis,null);
  await store.update(record.id,current=>({...current,state:'submitted'}));
  const reopened=await openHubStore(dir,demoProfile), next=await importSearchJobs(reopened,hits,defaultDiscoveryConfig);
  assert.equal(next.added,0); assert.equal(next.duplicates,4); assert.equal(reopened.get(record.id).state,'submitted');
  const senior=searchHits([{link:'https://www.linkedin.com/jobs/view/9999999999',title:'Senior Software Engineer',snippet:'Minimum 5 years of experience required.'}],query);
  assert.equal((await importSearchJobs(reopened,senior.hits,defaultDiscoveryConfig)).filtered,1);
});

test('panel finds individual jobs without a company catalogue, keeps foreign sites unfetched and blocks analysis until complete posting verification', async t => {
  const dir=await mkdtemp(join(tmpdir(),'careerpilot-role-hub-')); let requests=0, modelCalls=0, sourceReads=0;
  const sourceSearch=await openSourceSearch(join(dir,'search'),'fictional-secret',async input=>{
    const url=new URL(String(input)); assert.equal(url.origin,'https://serpapi.com'); requests++;
    if(url.pathname==='/account.json') return json({account_status:'Active',plan_monthly_price:0,total_searches_left:250,account_rate_limit_per_hour:50,this_hour_searches:0});
    return json({search_metadata:{status:'Success'},organic_results:rows});
  });
  const hub=await startHub({directory:join(dir,'jobs'),profile:demoProfile,sourceSearch,
    analyze:async()=>{modelCalls++;throw new Error('must not call model');},discoveryReader:async()=>{sourceReads++;throw new Error('must not read company feeds');}});
  t.after(async()=>{await hub.close();await rm(dir,{recursive:true,force:true});});
  const session=await(await fetch(hub.origin+'/api/session')).json();
  const request=(path:string,data?:unknown,origin=hub.origin)=>fetch(hub.origin+path,{method:data===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Hub-Token':session.token},...(data===undefined?{}:{body:JSON.stringify(data)})});
  assert.equal((await request('/api/discovery/job-search',{approved:true,scope:'turkey'},'https://attacker.invalid')).status,403);
  assert.equal((await request('/api/discovery/job-search',{approved:false,scope:'turkey'})).status,400); assert.equal(requests,0);
  assert.equal((await(await request('/api/discovery')).json()).config.sources.length,0);
  const plan=await(await request('/api/discovery/job-search-plan?scope=turkey')).json();
  assert.ok(plan.roleProfiles.some((item:{id:string})=>item.id==='finance')); assert.equal(requests,0);
  const preview=await(await request('/api/discovery/job-search-plan?scope=turkey&roles=data%20analyst,veri%20analisti&earlyCareer=false')).json();
  assert.equal(preview.queries.length,2); assert.ok(preview.queries.every((q:string)=>!q.includes('junior')));
  assert.equal(requests,0); // Preview cannot consume quota or save the preset.
  assert.deepEqual((await(await request('/api/discovery')).json()).config.roles,defaultDiscoveryConfig.roles);
  assert.equal((await request('/api/discovery/job-search-plan?roles=')).status,400);
  const report=await(await request('/api/discovery/job-search',{approved:true,scope:'turkey'})).json();
  assert.equal(report.added,3); assert.equal(report.requests,2); assert.equal(report.examined,8); assert.equal(sourceReads,0);
  assert.equal(requests,3); const repeated=await(await request('/api/discovery/job-search',{approved:true,scope:'turkey'})).json();
  assert.equal(repeated.requests,0); assert.equal(repeated.added,0); assert.equal(repeated.duplicates,3); assert.equal(requests,3);
  const jobs=await(await request('/api/jobs')).json(), path='/api/jobs/'+jobs[0].id;
  let detail=await(await request(path)).json(); assert.equal(detail.cv,null); assert.equal(detail.assistant.available,false); assert.equal(detail.score,null);
  assert.equal((await request(path+'/routing',{country:'TR',language:'en'})).status,400);
  assert.equal((await request(path+'/analyze',{paidCallApproved:true,cloudProfileApproved:true})).status,409); assert.equal(modelCalls,0);
  assert.equal((await request(path+'/verify-posting',{company:'Fictional Employer',title:'Junior Developer',text:'short',country:'TR',language:'en'})).status,400);
  const verified=await request(path+'/verify-posting',{company:'Fictional Employer',title:'Junior Developer',text:'Full fictional job description. JavaScript knowledge required; build and test interfaces.',country:'TR',language:'en'});
  assert.equal(verified.status,200); detail=await verified.json(); assert.equal(detail.discovery.search.verified,true); assert.equal(detail.discovery.routingConfirmed,true); assert.equal(detail.posting.company,'Fictional Employer'); assert.ok(detail.cv);
  assert.equal(modelCalls,0); assert.equal((await(await request('/api/discovery')).json()).config.sources.length,0);
});

test('role presets search both languages within the same two-request budget', () => {
  for (const profile of roleProfiles) {
    const queries = jobSearchQueries({roles:profile.roles,locations:['Türkiye','Turkey','Istanbul']});
    assert.ok(queries.length <= 2);
    for (const role of profile.roles) assert.ok(queries.some(query => query.includes('"' + role + '"')));
    assert.ok(queries.every(query => query.length <= 400));
  }
});

test('rejection diagnostics distinguish listing pages, other sites, unsafe URLs and incomplete postings', () => {
  const parsed = searchHits([
    {link:'https://jobs.lever.co/fictional',title:'Company jobs'},
    {link:'https://www.linkedin.com/jobs/search',title:'Search jobs'},
    {link:'https://example.invalid/jobs/123',title:'Unsupported'},
    {link:'https://127.0.0.1/private',title:'Private'},
    {link:'https://www.linkedin.com/jobs/view/123'},
    {link:'https://tr.indeed.com/viewjob?jk=bad',title:'Broken ID'},
  ],query);
  assert.deepEqual(parsed.rejectionReasons,{listingPage:2,unsupportedSite:1,unsafeURL:1,missingTitle:1,invalidPosting:1});
  assert.equal(Object.values(parsed.rejectionReasons).reduce((a,b)=>a+b,0),parsed.rejected);
});

test('English configured roles accept Turkish equivalents without adding unrelated roles or applicant facts', async t => {
  const dir=await mkdtemp(join(tmpdir(),'careerpilot-role-aliases-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=await openHubStore(dir,demoProfile);
  const config={...defaultDiscoveryConfig,roles:['software engineer'],excludedTitles:[],keywords:[]};
  const hits=searchHits([
    {link:'https://www.linkedin.com/jobs/view/100',title:'Yeni Mezun Yazılım Mühendisi'},
    {link:'https://www.linkedin.com/jobs/view/101',title:'Junior Data Analyst'},
    {link:'https://www.linkedin.com/jobs/view/102',title:'Software Engineer',snippet:'Minimum 5 years of experience required.'},
  ],query).hits;
  const report=await importSearchJobs(store,hits,config);
  assert.equal(report.added,1); assert.equal(report.filtered,2);
  assert.deepEqual(report.filterReasons,{role:1,excludedTitle:0,keyword:0,experience:1});
  assert.equal(store.list()[0]!.analysis,null); assert.equal(store.list()[0]!.discovery?.search?.verified,false);
});

test('search date hints remain unverified source text, separate from discovery time, across restart', async t => {
  const dir=await mkdtemp(join(tmpdir(),'careerpilot-date-hints-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=await openHubStore(dir,demoProfile), clock=()=>new Date('2026-10-19T12:00:00Z');
  const hits=searchHits([{link:'https://www.linkedin.com/jobs/view/12345',title:'Junior Software Engineer',date:'<b>2 years ago</b>'}],query).hits;
  await importSearchJobs(store,hits,defaultDiscoveryConfig,clock);
  const record=(await openHubStore(dir,demoProfile)).list()[0]!;
  assert.equal(record.discovery?.discoveredAt,clock().toISOString());
  assert.equal(record.discovery?.search?.dateHint,'2 years ago');
  assert.equal(record.discovery?.search?.verified,false); assert.equal(record.state,'review'); assert.equal(record.analysis,null);
});

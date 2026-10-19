import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createFreehireSearch,importFreehireJobs} from '../src/discovery/freehire.js';
import {openHubStore} from '../src/hub/store.js';
import {demoProfile} from '../src/hub/demo.js';
import {defaultDiscoveryConfig} from '../src/discovery/core.js';
import {startHub} from '../src/hub/server.js';
const criteria={scope:'turkey' as const,earlyCareer:true,page:1};
const row={public_slug:'junior-developer-fictional-123',title:'Junior Software Engineer',company:'Fictional Software',description:'Build fictional software and test interfaces with the team.',countries:['tr'],location:'Istanbul',posted_at:'2026-10-19T10:00:00Z',closed_at:null};
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});

test('FreeHire sends only bounded public filters, caches by page/criteria, and does not follow employer links',async()=>{
  let calls=0,clock=0;
  const search=createFreehireSearch(async(input,init)=>{calls++;const url=new URL(String(input));assert.equal(url.origin,'https://freehire.me');assert.equal(url.pathname,'/api/v1/agent/jobs/search');assert.equal(url.searchParams.get('countries'),'TR');assert.equal(url.searchParams.get('seniority'),'junior');assert.equal(url.searchParams.get('limit'),'30');assert.equal(url.searchParams.get('posted_within_days'),'30');assert.equal(init?.redirect,'error');assert.equal(init?.credentials,'omit');assert.ok(!url.href.includes(demoProfile.contact.email));return json({data:[row],meta:{total:31}});},()=>clock);
  assert.equal((await search(criteria,new AbortController().signal)).rows.length,1);
  assert.equal((await search(criteria,new AbortController().signal)).cached,true);assert.equal(calls,1);
  await assert.rejects(search({...criteria,page:2},new AbortController().signal),/COOLDOWN/);
  clock=31_000;await search({...criteria,page:2},new AbortController().signal);assert.equal(calls,2);
  await assert.rejects(search({...criteria,page:11},new AbortController().signal));assert.equal(calls,2);
  const remote=createFreehireSearch(async input=>{const url=new URL(String(input));assert.equal(url.searchParams.get('work_mode'),'remote');assert.equal(url.searchParams.has('countries'),false);assert.equal(url.searchParams.has('seniority'),false);return json({data:[],meta:{total:0}});});
  await remote({scope:'remote',earlyCareer:false,page:1},new AbortController().signal);

});

test('FreeHire stops on rate limits, malformed payloads and oversized streams without retries',async()=>{
  for(const mode of ['rate','format','large']){
    let calls=0;const search=createFreehireSearch(async()=>{calls++;return mode==='rate'?new Response('',{status:429}):mode==='format'?json({data:'bad'}):new Response(new Uint8Array(4_000_001),{headers:{'Content-Type':'application/json'}});});
    await assert.rejects(search(criteria,new AbortController().signal),new RegExp(mode==='rate'?'RATE_LIMITED':mode==='format'?'FORMAT':'TOO_LARGE'));assert.equal(calls,1);
    await assert.rejects(search(criteria,new AbortController().signal),/COOLDOWN/);assert.equal(calls,1);
  }
});

test('FreeHire import preserves full source text, filters closed/foreign/senior rows and deduplicates submitted jobs across restart',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'careerpilot-freehire-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=await openHubStore(dir,demoProfile),search=createFreehireSearch(async()=>json({data:[row,{...row,public_slug:'closed-job',closed_at:'2026-10-18T10:00:00Z'},{...row,public_slug:'foreign-job',countries:['de']},{...row,public_slug:'senior-job',title:'Senior Software Engineer'}],meta:{total:4}}));
  const data=await search(criteria,new AbortController().signal),report=await importFreehireJobs(store,data.rows,defaultDiscoveryConfig,'turkey');
  assert.equal(report.added,1);assert.equal(report.closed,1);assert.equal(report.filtered,2);
  const record=store.list()[0]!;assert.equal(record.posting.text,row.description);assert.equal(record.posting.company,row.company);assert.equal(record.posting.country,'ZZ');assert.equal(record.discovery?.search?.verified,false);assert.equal(record.analysis,null);
  await store.update(record.id,current=>({...current,state:'submitted'}));
  const reopened=await openHubStore(dir,demoProfile);assert.equal((await importFreehireJobs(reopened,data.rows,defaultDiscoveryConfig,'turkey')).duplicates,1);assert.equal(reopened.get(record.id).state,'submitted');
  const duplicateReader=createFreehireSearch(async()=>json({data:[{...row,public_slug:'different-aggregator-id',url:record.posting.sourceUrl}],meta:{total:1}}));
  assert.equal((await importFreehireJobs(reopened,(await duplicateReader(criteria,new AbortController().signal)).rows,defaultDiscoveryConfig,'turkey')).duplicates,1);
});

test('hub integrates FreeHire without SerpAPI keys, enforces origin/approval, and requires human verification before analysis',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'careerpilot-freehire-hub-'));let requests=0,models=0;
  const hub=await startHub({directory:join(dir,'jobs'),profile:demoProfile,freehireSearch:createFreehireSearch(async()=>{requests++;return json({data:[row,{...row,public_slug:'similar-role-other-source'}],meta:{total:2}});}),analyze:async()=>{models++;throw new Error('must not call');}});
  t.after(async()=>{await hub.close();await rm(dir,{recursive:true,force:true});});
  const session=await(await fetch(hub.origin+'/api/session')).json();
  const send=(path:string,data?:unknown,origin=hub.origin)=>fetch(hub.origin+path,{method:data?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json','X-Hub-Token':session.token},...(data?{body:JSON.stringify(data)}:{})});
  assert.equal((await send('/api/discovery/freehire',{approved:false,scope:'turkey'})).status,400);
  assert.equal((await send('/api/discovery/freehire',{approved:true,scope:'turkey'},'https://attacker.invalid')).status,403);assert.equal(requests,0);
  assert.equal((await(await send('/api/discovery/freehire',{approved:true,scope:'turkey'})).json()).added,2);assert.equal(requests,1);
  const records=await(await send('/api/jobs')).json();assert.ok(records[0].possibleDuplicate);assert.notEqual(records[0].possibleDuplicate.id,records[0].id);const path='/api/jobs/'+records[0].id;
  assert.equal((await send(path+'/analyze',{paidCallApproved:true,cloudProfileApproved:true})).status,409);assert.equal(models,0);
  const verified=await(await send(path+'/verify-posting',{company:row.company,title:row.title,text:row.description,country:'TR',language:'en'})).json();
  assert.equal(verified.discovery.search.verified,true);assert.equal(verified.assistant.available,false);
  assert.equal((await(await send('/api/discovery/freehire',{approved:true,scope:'turkey'})).json()).duplicates,2);assert.equal(requests,1);
});

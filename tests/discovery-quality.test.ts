import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createFreehireSearch,importFreehireJobs} from '../src/discovery/freehire.js';
import {jobQuality} from '../src/discovery/quality.js';
import {createPostingChecker} from '../src/discovery/check-posting.js';
import {createSourceReader} from '../src/discovery/sources.js';
import {careerLevel} from '../src/discovery/level.js';
import {openHubStore} from '../src/hub/store.js';
import {startHub} from '../src/hub/server.js';
import {demoProfile} from '../src/hub/demo.js';
import {defaultDiscoveryConfig} from '../src/discovery/core.js';
const now=()=>new Date('2026-10-20T08:00:00Z');
const description='Build fictional software and test accessible interfaces with experienced colleagues. Write meaningful tests, document changes and review code with the team. This fictional entry role welcomes recent graduates and offers mentoring throughout onboarding and the first months.';
const row={public_slug:'fictional-engineer',title:'Junior Software Engineer',description,company:'Fictional Company',countries:['TR'],source:'greenhouse',created_at:'2026-10-19T08:00:00Z',posted_at:'2026-10-19T08:00:00Z',url:'https://job-boards.greenhouse.io/fictional/jobs/101'};
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});

test('fresh-looking reposts, stale originals, missing descriptions and indirect rewrites never enter review',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'careerpilot-quality-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=await openHubStore(dir,demoProfile),search=createFreehireSearch(async()=>json({data:[
  row,{...row,public_slug:'fake-fresh',url:undefined,reality:{fake_freshness:true}},
  {...row,public_slug:'old-original',url:undefined,created_at:'2026-07-01T00:00:00Z'},
  {...row,public_slug:'old-source-age',url:undefined,reality:{age_days:90}},
  {...row,public_slug:'future-date',url:undefined,posted_at:'2027-01-01T00:00:00Z'},
  {...row,public_slug:'empty-description',url:undefined,description:'Apply now'},
  {...row,public_slug:'indirect-rewrite',url:undefined,source:'whatjobs-tr'},
  {...row,public_slug:'missing-company',url:undefined,company:null},
 ],meta:{total:8}}));
 const result=await search({scope:'turkey',earlyCareer:true,page:1},new AbortController().signal);
 const report=await importFreehireJobs(store,result.rows,defaultDiscoveryConfig,'turkey',now);
 assert.equal(report.added,1);assert.equal(report.qualityRejected,7);assert.deepEqual(report.qualityReasons,{stale:4,incomplete:2,indirectSource:1});
 const record=store.list()[0]!;assert.equal(jobQuality(record,true,now()).bucket,'check');assert.equal(record.discovery?.provenance?.source,'greenhouse');
 const saved=await openHubStore(dir,demoProfile);assert.deepEqual(saved.get(record.id).discovery?.provenance,record.discovery?.provenance);
 // Repeated search enriches only unreviewed source metadata. Submissions, hidden records and notes stay byte-identical.
 await store.update(record.id,current=>({...current,state:'submitted',tracking:{stage:'assessment',appliedOn:null,followUpOn:null,notes:'Fictional private note'}}));
 const before=await readFile(join(dir,record.id+'.json'),'utf8');
 await importFreehireJobs(store,[{...result.rows[0]!,reality:{fake_freshness:true}}],defaultDiscoveryConfig,'turkey',now);
 assert.equal(await readFile(join(dir,record.id+'.json'),'utf8'),before);
});

test('employer checks use fixed ATS APIs, reuse results, and distinguish absence from failure',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'careerpilot-source-check-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=await openHubStore(dir,demoProfile);await importFreehireJobs(store,[row],defaultDiscoveryConfig,'turkey',now);const record=store.list()[0]!;
 let calls=0;
 const checker=createPostingChecker(createSourceReader(async(input,init)=>{calls++;assert.equal(String(input),'https://boards-api.greenhouse.io/v1/boards/fictional/jobs?content=true');assert.equal(init?.redirect,'error');assert.equal(init?.credentials,'omit');return json({jobs:[{id:101,title:row.title,absolute_url:row.url,content:description,location:{name:'Istanbul'}}]});}),now);
 const result=await checker(record,new AbortController().signal);assert.equal(result.check.status,'open');assert.equal(result.job?.text,description);
 await checker(record,new AbortController().signal);assert.equal(calls,1);
 const checked={...record,discovery:{...record.discovery!,sourceCheck:result.check}};assert.equal(jobQuality(checked,true,now()).bucket,'review');
 const indirect={...record,discovery:{...record.discovery!,provenance:{...record.discovery!.provenance!,source:'whatjobs-tr'}}};assert.equal(jobQuality(indirect,true,now()).bucket,'excluded');
 assert.equal(jobQuality({...indirect,discovery:{...indirect.discovery!,search:{...indirect.discovery!.search!,verified:true}}},true,now()).label,'Kullanıcı doğruladı');
 assert.equal(jobQuality(checked,true,new Date('2026-10-21T09:00:00Z')).bucket,'check');
 const absent=await createPostingChecker(async()=>({jobs:[],rejected:0}),now)(record,new AbortController().signal);assert.equal(absent.check.status,'not_listed');
 const rejected=await createPostingChecker(async()=>({jobs:[],rejected:1}),now)(record,new AbortController().signal);assert.equal(rejected.check.status,'unavailable');
 const failed=await createPostingChecker(async()=>{throw new Error('HTTP 429');},now)(record,new AbortController().signal);assert.equal(failed.check.status,'unavailable');
 assert.equal(jobQuality({...record,discovery:{...record.discovery!,sourceCheck:failed.check}},true,now()).bucket,'check');
 await assert.rejects(checker({...record,discovery:{...record.discovery!,search:{...record.discovery!.search!,originalURL:'https://127.0.0.1/private'}}},new AbortController().signal),/UNSUPPORTED/);assert.equal(calls,1);
});

test('native search checks an official employer before calling a result ready, without model calls',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'careerpilot-quality-hub-'));let requests=0;
 const hub=await startHub({directory:join(dir,'jobs'),profile:demoProfile,
 freehireSearch:createFreehireSearch(async()=>json({data:[{...row,created_at:new Date().toISOString(),posted_at:new Date().toISOString()},{...row,public_slug:'fictional-relabeled',url:row.url.replace('101','102'),created_at:new Date().toISOString(),posted_at:new Date().toISOString()}],meta:{total:2}})),
 discoveryReader:async()=>{requests++;return {jobs:[{externalId:'101',title:row.title,text:description,url:row.url,location:'Istanbul',remote:false},{externalId:'102',title:'Sales Specialist',text:description,url:row.url.replace('101','102'),location:'Istanbul',remote:false}],rejected:0};}});
 t.after(async()=>{await hub.close();await rm(dir,{recursive:true,force:true});});
 const session=await(await fetch(hub.origin+'/api/session')).json(),headers={Origin:hub.origin,'Content-Type':'application/json','X-Hub-Token':session.token};
 const send=(path:string,data?:unknown)=>fetch(hub.origin+path,{method:data?'POST':'GET',headers,...(data?{body:JSON.stringify(data)}:{})});
 const report=await(await send('/api/discovery/freehire',{approved:true,scope:'turkey'})).json();assert.equal(report.ready,1);assert.equal(report.checked,2);assert.equal(report.modelCalls,0);assert.equal(requests,1);
 const allRecords=await(await send('/api/jobs')).json();assert.equal(allRecords.find((record:{title:string})=>record.title==='Sales Specialist').quality.bucket,'excluded');
 const records=allRecords.filter((record:{title:string})=>record.title===row.title);assert.equal(records[0].quality.bucket,'review');assert.equal(records[0].quality.label,'Resmî kaynakta mevcut');assert.equal(records[0].discovery.search.verified,false);
 const path='/api/jobs/'+records[0].id;
 assert.equal((await fetch(hub.origin+path+'/check-source',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
 assert.equal((await send(path+'/check-source',{})).status,200);assert.equal(requests,1);
 assert.equal((await send(path+'/analyze',{paidCallApproved:true,cloudProfileApproved:true})).status,409);
 const verified=await(await send(path+'/verify-posting',{company:row.company,title:row.title,text:description,country:'TR',language:'en'})).json();assert.equal(verified.assistant.available,true);assert.equal(verified.assistant.recipientOrigin,'https://job-boards.greenhouse.io');assert.equal((await send(path+'/assistant',{action:'start',contactApproved:false})).status,403);
 // Persist known-stale provenance, restart and confirm the human routing step cannot bypass the paid-call quality gate.
 const store=await openHubStore(join(dir,'jobs'),demoProfile);
 await store.update(records[0].id,current=>({...current,discovery:{...current.discovery!,provenance:{...current.discovery!.provenance!,fakeFreshness:true},routingConfirmed:true,search:{...current.discovery!.search!,verified:true}}}));
 let models=0;const reopened=await startHub({directory:join(dir,'jobs'),profile:demoProfile,analyze:async()=>{models++;throw new Error('must not call');}});
 try{const auth=await(await fetch(reopened.origin+'/api/session')).json();const response=await fetch(reopened.origin+path+'/analyze',{method:'POST',headers:{Origin:reopened.origin,'Content-Type':'application/json','X-Hub-Token':auth.token},body:JSON.stringify({paidCallApproved:true,cloudProfileApproved:true})});assert.equal(response.status,409);assert.equal((await response.json()).code,'HUB_JOB_QUALITY_REQUIRED');assert.equal(models,0);}finally{await reopened.close();}

});

test('experience screening catches plus and ranges while preserving optional and company-history statements',()=>{
 for(const text of ['3+ years of experience building APIs.','Required: 4–6 years of relevant experience.','En az 3 yıllık deneyim gereklidir.','Minimum 5 years of professional experience required.'])assert.equal(careerLevel({title:'Junior Developer',text}).level,'experienced',text);
 for(const text of ['1-3 years of experience building applications.','3+ years of experience preferred.','Our company has 20 years of experience serving customers.','Our team: we have 10 years of experience.'])assert.equal(careerLevel({title:'Software Engineer',text}).level,'unclear',text);
 assert.equal(careerLevel({title:'Software Engineer',text:'3+ years of experience required. Docker is preferred.'}).level,'experienced');
 assert.equal(careerLevel({title:'Software Engineer',text:'Docker is preferred. 3+ years of experience required.'}).level,'experienced');
});

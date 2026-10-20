import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {roleProfiles,roleTerms,discoveryCategories} from '../src/discovery/role-profiles.js';
import {careerLevel} from '../src/discovery/level.js';
import {jobSearchQueries} from '../src/discovery/source-search.js';
import {searchFilterReason} from '../src/discovery/job-results.js';
import {defaultDiscoveryConfig} from '../src/discovery/core.js';
import {profileSchema,selectCV} from '../src/preparation/core.js';
import {renderCoverLetter} from '../src/preparation/letters.js';
import {createFreehireSearch} from '../src/discovery/freehire.js';
import {openSourceSearch} from '../src/discovery/search-provider.js';
import {startHub} from '../src/hub/server.js';
import {demoProfile} from '../src/hub/demo.js';
const finance=roleProfiles.find(profile=>profile.id==='finance')!;
const text='Prepare monthly financial reports with the finance team. Review expense data and help maintain accurate records. Work with spreadsheets, support reconciliations and communicate findings to colleagues. This fictional junior opportunity welcomes recent graduates and offers structured mentoring.';
const profile=profileSchema.parse({...demoProfile,cvs:[...demoProfile.cvs,...demoProfile.cvs.map(cv=>({...cv,id:'finance-'+cv.id,path:'/fictional/finance-'+cv.id+'.pdf',focus:'finance'})),{id:'finance-en-plain',language:'en',photo:false,path:'/fictional/finance-en-plain.pdf',focus:'finance'}],facts:[...demoProfile.facts,{id:'finance-background',text:{tr:'Finans ve muhasebe eğitimi aldım.',en:'I studied finance and accounting.'},source:'Fictional finance transcript'}],financeLetterFactIds:['finance-background']});
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});

test('finance and marketing role families use supported categories and preserve bounded bilingual search plans',()=>{
 const config={...defaultDiscoveryConfig,roles:finance.roles};
 assert.deepEqual(discoveryCategories(finance.roles),['finance']);
 assert.deepEqual(discoveryCategories(roleProfiles.find(profile=>profile.id==='marketing')!.roles),['marketing']);
 for(const title of ['Finansal Raporlama Uzman Yardımcısı','Muhasebe Elemanı','Junior Financial Analyst','Accounts Payable Assistant','Hazine Uzman Yardımcısı','Audit Associate'])assert.equal(searchFilterReason(title,text,config),null,title);
 assert.equal(searchFilterReason('Senior Financial Analyst',text,config),'excludedTitle');assert.equal(searchFilterReason('Junior Developer',text,config),'role');
 assert.ok(roleTerms(['finance']).includes('finansal'));
 assert.equal(careerLevel({title:'Supervisor-Accounting',text}).level,'experienced');assert.equal(careerLevel({title:'Accounts Payable Associate',text}).level,'unclear');
 for(const preset of roleProfiles){const queries=jobSearchQueries({roles:preset.roles,locations:['Turkey','Türkiye','Istanbul']});assert.equal(queries.length,2);assert.ok(queries.every(query=>query.length<=400));assert.ok(queries.some(query=>query.includes('uzman yardımcısı')));}
});

test('finance CV selection respects language/photo instructions and never makes the general profile ambiguous',()=>{
 const job={language:'en' as const,documentLanguage:null,country:'TR',photoPolicy:'unspecified' as const};
 assert.equal(selectCV(profile,job).id,selectCV(demoProfile,job).id);
 assert.match(selectCV(profile,job,'finance').id,/^finance-/);
 assert.equal(selectCV(profile,{...job,country:'GB'},'finance').photo,false);
 assert.equal(selectCV(profile,{...job,documentLanguage:'tr'},'finance').language,'tr');
 assert.equal(selectCV(profile,{...job,photoPolicy:'forbidden'},'finance').photo,false);
 assert.throws(()=>selectCV(demoProfile,job,'finance'),/UNAVAILABLE/);
 const letter=renderCoverLetter(profile,{company:'Fictional Bank',title:'Junior Financial Analyst',language:'en',documentLanguage:null},{coverLetterFactIds:[]},'finance');
 assert.match(letter.content,/I studied finance and accounting/);assert.equal(letter.evidence.mode,'selected_facts');assert.equal('reviewedOn' in letter.evidence,false);
 assert.equal(profileSchema.safeParse({...profile,financeLetterFactIds:['invented']}).success,false);
});

test('one native search isolates provider failure, persists results, prepares finance documents and keeps application notes',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'careerpilot-finance-hub-')),pdf=join(dir,'finance.pdf');await writeFile(pdf,'%PDF-1.7\nfictional finance fixture');
 const local={...profile,cvs:profile.cvs.map(cv=>({...cv,path:cv.focus==='finance'?pdf:'/fictional/general.pdf'}))};let webRequests=0,models=0;
 const web=await openSourceSearch(join(dir,'search'),'fictional-key',async input=>{const url=new URL(String(input));if(url.pathname==='/account.json')return json({account_status:'Active',plan_monthly_price:0,total_searches_left:250,account_rate_limit_per_hour:100,this_hour_searches:0});webRequests++;assert.equal(url.searchParams.get('tbs'),'qdr:m');return json({search_metadata:{status:'Success'},organic_results:[{link:'https://www.linkedin.com/jobs/view/123456789',title:'Junior Financial Analyst',snippet:text,date:'2 days ago'}]});});
 const opts={directory:join(dir,'jobs'),profile:local,sourceSearch:web,freehireSearch:createFreehireSearch(async()=>new Response('',{status:503})),discoveryReader:async()=>({jobs:[{externalId:'101',title:'Junior Finance Analyst',text,url:'https://job-boards.greenhouse.io/fictional/jobs/101',location:'Istanbul, Turkey',remote:false}],rejected:0}),analyze:async()=>{models++;throw new Error('must not call');}};
 let hub=await startHub(opts);t.after(async()=>{await hub.close();await rm(dir,{recursive:true,force:true});});
 let auth=await(await fetch(hub.origin+'/api/session')).json();
 const send=(path:string,data?:unknown,origin=hub.origin)=>fetch(hub.origin+path,{method:data?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json','X-Hub-Token':auth.token},...(data?{body:JSON.stringify(data)}:{})});
 const prior=await(await send('/api/jobs',{company:'Fictional Old Employer',title:'Junior Analyst',sourceUrl:'https://example.invalid/old-job',text,country:'TR',language:'en'})).json();
 await send('/api/jobs/'+prior.id+'/status',{state:'submitted'});await send('/api/jobs/'+prior.id+'/tracking',{stage:'interview',appliedOn:'2026-10-01',followUpOn:'2026-10-25',notes:'Fictional interview note'});
 const priorFile=join(dir,'jobs',prior.id+'.json'),before=await readFile(priorFile,'utf8');
 const config={...defaultDiscoveryConfig,customRoles:['software engineer','product'],roles:finance.roles,sources:[{provider:'greenhouse',board:'fictional',company:'Fictional Finance'}]};
 assert.equal((await send('/api/discovery/config',config)).status,200);
 assert.equal((await send('/api/discovery/search',{approved:true,scope:'turkey',documentFocus:'finance'},'https://attacker.invalid')).status,403);assert.equal(webRequests,0);
 const report=await(await send('/api/discovery/search',{approved:true,scope:'turkey',documentFocus:'finance'})).json();
 assert.equal(report.state,'partial');assert.equal(report.sources[0].code,'DISCOVERY_FREEHIRE_HTTP');assert.equal(report.added,2);assert.equal(report.ready,1);assert.equal(webRequests,2);assert.equal(models,0);
 const records=await(await send('/api/jobs')).json(),record=records.find((row:{title:string})=>row.title==='Junior Finance Analyst');
 assert.equal(record.documentFocus,'finance');assert.equal(record.quality.bucket,'review');
 assert.equal((await send('/api/jobs/'+record.id+'/documents')).status,409);
 await send('/api/jobs/'+record.id+'/routing',{country:'TR',language:'en'});
 const docs=await(await send('/api/jobs/'+record.id+'/documents')).json();assert.equal(docs.cv.filename,'finance.pdf');assert.match(docs.letter,/finance and accounting/);assert.equal(docs.modelCalls,0);
 assert.match(await(await send('/api/jobs/'+record.id+'/cv')).text(),/^%PDF-/);
 // A different active role search cannot relabel a previously discovered finance record.
 await send('/api/discovery/config',{...config,roles:['software engineer']});
 assert.equal((await(await send('/api/jobs/'+record.id)).json()).quality.bucket,'review');
 assert.deepEqual((await(await send('/api/discovery')).json()).config.customRoles,['software engineer','product']);
 assert.equal((await send('/api/jobs/'+record.id+'/document-focus',{focus:'general'})).status,200);
 assert.equal((await(await send('/api/jobs/'+record.id)).json()).cv.id,selectCV(demoProfile,{language:'en',documentLanguage:null,country:'TR',photoPolicy:'unspecified'}).id);
 assert.equal(await readFile(priorFile,'utf8'),before);
 await hub.close();hub=await startHub(opts);auth=await(await fetch(hub.origin+'/api/session')).json();
 const restored=await(await send('/api/discovery')).json();assert.equal(restored.lastSearch.state,'partial');assert.equal(restored.lastSearch.added,2);assert.equal(webRequests,2);assert.equal(await readFile(priorFile,'utf8'),before);
});

test('a running search can be stopped and cannot overlap another scan or change its configuration',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'careerpilot-finance-stop-'));let started!:()=>void;const entered=new Promise<void>(resolve=>{started=resolve;});
 const hub=await startHub({directory:join(dir,'jobs'),profile:demoProfile,freehireSearch:createFreehireSearch(async(_input,init)=>{started();return new Promise<Response>((_resolve,reject)=>{init!.signal!.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});})});
 t.after(async()=>{await hub.close();await rm(dir,{recursive:true,force:true});});
 const auth=await(await fetch(hub.origin+'/api/session')).json();const send=(path:string,data:unknown)=>fetch(hub.origin+path,{method:'POST',headers:{Origin:hub.origin,'Content-Type':'application/json','X-Hub-Token':auth.token},body:JSON.stringify(data)});
 const first=send('/api/discovery/search',{approved:true,scope:'turkey'});await entered;
 assert.equal((await send('/api/discovery/search',{approved:true,scope:'turkey'})).status,400);
 assert.equal((await send('/api/discovery/config',defaultDiscoveryConfig)).status,400);
 assert.equal((await send('/api/discovery/search/stop',{})).status,200);
 const result=await(await first).json();assert.equal(result.state,'cancelled');assert.equal(result.added,0);assert.equal(result.sources[1].status,'skipped');assert.equal(result.sources[2].status,'skipped');
});

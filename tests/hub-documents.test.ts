import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startHub} from '../src/hub/server.js';
import {demoProfile} from '../src/hub/demo.js';
import {createFreehireSearch} from '../src/discovery/freehire.js';

test('panel prepares sourced local letter and selected PDF without model calls or private path exposure',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'careerpilot-hub-docs-')),pdf=join(dir,'fictional.pdf');await writeFile(pdf,'%PDF-1.7\nfictional fixture');let models=0;
 const profile={...demoProfile,cvs:demoProfile.cvs.map(cv=>({...cv,path:pdf})),coverLetter:{reviewedOn:'2026-10-20',sections:[{kind:'introduction' as const,text:{en:'I studied information systems and worked on academic projects.',tr:'Bilgi sistemleri eğitimi aldım ve akademik projelerde çalıştım.'},factIds:['degree']}]}};
 const hub=await startHub({directory:join(dir,'jobs'),profile,analyze:async()=>{models++;throw new Error('must not call');}});t.after(async()=>{await hub.close();await rm(dir,{recursive:true,force:true});});
 const session=await(await fetch(hub.origin+'/api/session')).json();const headers={Origin:hub.origin,'Content-Type':'application/json','X-Hub-Token':session.token};
 const record=await(await fetch(hub.origin+'/api/jobs',{method:'POST',headers,body:JSON.stringify({company:'Fictional Employer',title:'Junior Analyst',sourceUrl:'https://example.invalid/job',text:'Fictional requirements for a junior analyst position.',country:'TR',language:'en'})})).json();
 const path=hub.origin+'/api/jobs/'+record.id;
 assert.equal((await fetch(path+'/documents')).status,403);assert.equal((await fetch(path+'/cv',{headers:{...headers,Origin:'https://attacker.invalid'}})).status,403);
 const docs=await(await fetch(path+'/documents',{headers})).json();assert.equal(docs.modelCalls,0);assert.match(docs.letter,/Fictional Employer/);assert.match(docs.letter,/Junior Analyst/);assert.match(docs.letter,/academic projects/);assert.ok(!JSON.stringify(docs).includes(dir));
 const response=await fetch(path+'/cv',{headers});assert.equal(response.headers.get('content-type'),'application/pdf');assert.match(await response.text(),/^%PDF-/);assert.equal(models,0);
});

test('unverified source records cannot preview letters or download CV through direct endpoints',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'careerpilot-docs-unverified-'));
 const hub=await startHub({directory:join(dir,'jobs'),profile:demoProfile,freehireSearch:createFreehireSearch(async()=>new Response(JSON.stringify({data:[{public_slug:'fictional-junior',title:'Junior Software Engineer',company:'Fictional Company',description:'Build fictional software interfaces and test applications. Work with experienced colleagues on accessible interfaces, documentation, code reviews and meaningful unit tests. The fictional team welcomes new graduates and provides mentoring during onboarding and throughout the first months.',countries:['tr']}],meta:{total:1}}),{headers:{'Content-Type':'application/json'}}))});t.after(async()=>{await hub.close();await rm(dir,{recursive:true,force:true});});
 const session=await(await fetch(hub.origin+'/api/session')).json(),headers={Origin:hub.origin,'Content-Type':'application/json','X-Hub-Token':session.token};
 await fetch(hub.origin+'/api/discovery/freehire',{method:'POST',headers,body:JSON.stringify({approved:true,scope:'turkey'})});
 const records=await(await fetch(hub.origin+'/api/jobs',{headers})).json();
 for(const action of ['documents','cv'])assert.equal((await fetch(hub.origin+'/api/jobs/'+records[0].id+'/'+action,{headers})).status,409);
});

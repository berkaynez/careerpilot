import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openHubStore} from '../src/hub/store.js';
import {demoProfile,demoRecords} from '../src/hub/demo.js';
import {startHub} from '../src/hub/server.js';
import {searchHits,importSearchJobs} from '../src/discovery/job-results.js';
import {defaultDiscoveryConfig} from '../src/discovery/core.js';
const tracking={stage:'interview',appliedOn:'2026-10-19',followUpOn:'2026-10-23',notes:'Fictional interviewer requested a portfolio. No message sent.'};

test('cleanup hides only archived jobs, preserves submitted bytes, and restores after restart',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'careerpilot-trash-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=await openHubStore(dir,demoProfile),seeds=demoRecords();
  await store.add({...seeds[0]!,state:'submitted'});await store.add({...seeds[1]!,state:'archived'});
  const submitted=join(dir,seeds[0]!.id+'.json'),before=await readFile(submitted,'utf8');
  assert.equal((await store.trashArchived()).removed,1);assert.equal(store.list().length,1);assert.equal(store.list({includeTrashed:true}).length,2);
  assert.throws(()=>store.get(seeds[1]!.id),/HUB_NOT_FOUND/);
  await assert.rejects(store.update(seeds[1]!.id,row=>({...row,state:'submitted'})),/HUB_NOT_FOUND/);
  assert.equal(await readFile(submitted,'utf8'),before);
  const reopened=await openHubStore(dir,demoProfile);assert.equal(reopened.list().length,1);
  assert.equal((await reopened.restoreTrash()).restored,1);assert.equal(reopened.get(seeds[1]!.id).state,'archived');assert.equal(await readFile(submitted,'utf8'),before);
  assert.equal((await stat(join(dir,seeds[1]!.id+'.json'))).mode&0o777,0o600);
});

test('discarded search results cannot reappear after cleanup or restart',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'careerpilot-trash-dedup-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=await openHubStore(dir,demoProfile),hits=searchHits([{link:'https://www.linkedin.com/jobs/view/12345',title:'Junior Software Engineer'}],'fictional query').hits;
  await importSearchJobs(store,hits,defaultDiscoveryConfig);await store.update(store.list()[0]!.id,row=>({...row,state:'archived'}));await store.trashArchived();
  const reopened=await openHubStore(dir,demoProfile),again=await importSearchJobs(reopened,hits,defaultDiscoveryConfig);
  assert.equal(again.added,0);assert.equal(again.duplicates,1);assert.equal(reopened.list().length,0);
});

test('tracking and cleanup require trusted origin/session, validate dates and preserve state across restarts',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'careerpilot-tracking-api-'));let models=0;
  const hub=await startHub({directory:join(dir,'jobs'),profile:demoProfile,analyze:async()=>{models++;throw new Error('must not call');}});
  t.after(async()=>{await hub.close();await rm(dir,{recursive:true,force:true});});
  const session=await(await fetch(hub.origin+'/api/session')).json();
  const send=(path:string,data?:unknown,origin=hub.origin)=>fetch(hub.origin+path,{method:data===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Hub-Token':session.token},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const input={company:'Fictional Company',title:'Junior analyst',country:'TR',language:'en',sourceUrl:'https://www.linkedin.com/jobs/view/123',text:'Fictional job requirements for a junior analyst role.'};
  const created=await(await send('/api/jobs',input)).json(),path='/api/jobs/'+created.id;
  assert.equal(created.tracking,null);
  assert.equal((await send(path+'/tracking',tracking)).status,400);
  await send(path+'/status',{state:'submitted'});
  assert.equal((await send(path+'/tracking',tracking,'https://attacker.invalid')).status,403);
  assert.equal((await send(path+'/tracking',{...tracking,appliedOn:'2026-02-30'})).status,400);
  assert.equal((await send(path+'/tracking',{...tracking,followUpOn:'2026-10-18'})).status,400);
  assert.equal((await send(path+'/tracking',{...tracking,notes:'x'.repeat(4001)})).status,400);
  const saved=await(await send(path+'/tracking',tracking)).json();assert.deepEqual(saved.tracking,tracking);assert.equal(saved.state,'submitted');assert.equal(models,0);
  const second=await(await send('/api/jobs',{...input,title:'Other fictional role',sourceUrl:'https://www.linkedin.com/jobs/view/124'})).json();await send('/api/jobs/'+second.id+'/status',{state:'archived'});
  assert.equal((await send('/api/jobs/clear-archived',{},'https://attacker.invalid')).status,403);
  assert.equal((await(await send('/api/jobs/clear-archived',{})).json()).removed,1);
  assert.equal((await send('/api/jobs/'+second.id)).status,404);assert.equal((await(await send('/api/trash')).json()).count,1);
  const reopened=await openHubStore(join(dir,'jobs'),demoProfile);assert.deepEqual(reopened.get(created.id).tracking,tracking);assert.equal(reopened.list().length,1);
  assert.equal((await(await send('/api/trash/restore',{})).json()).restored,1);assert.equal((await(await send('/api/jobs/'+second.id)).json()).state,'archived');assert.equal(models,0);
});

test('individual removal preserves application tracking and restores only the selected record',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'careerpilot-single-trash-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=await openHubStore(dir,demoProfile),seeds=demoRecords();
  await store.add({...seeds[0]!,state:'submitted',tracking:{...tracking,stage:'interview'}});await store.add({...seeds[1]!,state:'archived'});
  await store.trashArchived();await store.trash(seeds[0]!.id);assert.equal(store.list().length,0);
  const reopened=await openHubStore(dir,demoProfile);const restored=await reopened.restore(seeds[0]!.id);
  assert.equal(restored.state,'submitted');assert.deepEqual(restored.tracking,tracking);assert.equal(reopened.list().length,1);assert.equal(reopened.list({includeTrashed:true}).filter(row=>row.trashedAt).length,1);
});

test('individual remove and restore endpoints enforce origin/session and leave other applications unchanged',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'careerpilot-single-trash-api-'));
  const hub=await startHub({directory:join(dir,'jobs'),profile:demoProfile,seed:demoRecords()});t.after(async()=>{await hub.close();await rm(dir,{recursive:true,force:true});});
  const session=await(await fetch(hub.origin+'/api/session')).json();
  const headers={Origin:hub.origin,'Content-Type':'application/json','X-Hub-Token':session.token};
  const records=await(await fetch(hub.origin+'/api/jobs',{headers})).json(),path='/api/jobs/'+records[0].id;
  const send=(action:string,origin=hub.origin)=>fetch(hub.origin+path+'/'+action,{method:'POST',headers:{...headers,Origin:origin},body:'{}'});
  assert.equal((await send('remove','https://attacker.invalid')).status,403);
  assert.equal((await send('remove')).status,200);assert.equal((await fetch(hub.origin+path,{headers})).status,404);
  assert.equal((await send('restore','https://attacker.invalid')).status,403);
  assert.equal((await send('restore')).status,200);
  const restored=await(await fetch(hub.origin+path,{headers})).json();assert.equal(restored.state,records[0].state);
  assert.equal((await(await fetch(hub.origin+'/api/jobs',{headers})).json()).length,2);
});

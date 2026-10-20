import {z} from 'zod';
import {importFreehireJobs} from './freehire.js';
import {searchFilterReason} from './job-results.js';
import {importSearchJobs} from './job-results.js';
import {discoveryCategories} from './role-profiles.js';
import {jobQuality} from './quality.js';
import type {createFreehireSearch} from './freehire.js';
import type {SourceSearch} from './search-provider.js';
import type {DiscoveryConfig} from './core.js';
import type {HubRecord,openHubStore} from '../hub/store.js';

const count=z.number().int().nonnegative();
export const searchRunSchema=z.strictObject({
 version:z.literal(1),startedAt:z.iso.datetime(),finishedAt:z.iso.datetime().nullable(),
 state:z.enum(['running','completed','partial','cancelled','interrupted']),scope:z.enum(['turkey','remote']),
 roles:z.array(z.string().max(120)).max(20),documentFocus:z.enum(['general','finance']),
 sources:z.array(z.strictObject({name:z.enum(['freehire','web','feeds']),status:z.enum(['pending','running','completed','partial','skipped','failed']),code:z.string().regex(/^DISCOVERY_[A-Z_]+$/).nullable(),
  examined:count,added:count,duplicates:count,filtered:count,rejected:count,qualityRejected:count,closed:count,requests:count})).max(3),
 added:count,ready:count,needsCheck:count,modelCalls:z.literal(0),
});
export type SearchRun=z.infer<typeof searchRunSchema>;
const safe=(error:unknown)=>error instanceof Error && /^DISCOVERY_[A-Z_]+$/.test(error.message)?error.message:'DISCOVERY_SOURCE_FAILED';
/** A bounded user-triggered run through existing providers. No new crawler, model or account session. */
export async function runDiscoverySearch(options:{
 store:Awaited<ReturnType<typeof openHubStore>>;config:DiscoveryConfig;scope:'turkey'|'remote';documentFocus:'general'|'finance';includeUnlabelled:boolean;
 freehire:ReturnType<typeof createFreehireSearch>;web?:SourceSearch;
 feeds:(signal:AbortSignal)=>Promise<{added:number;sources:{code:string|null;added:number;duplicates:number;filtered:number;rejected:number}[]}>;
 check:(id:string,signal:AbortSignal)=>Promise<HubRecord>;save:(report:SearchRun)=>Promise<void>;signal:AbortSignal;
}){
 const {store,config,signal}=options,before=new Set(store.list({includeTrashed:true}).map(row=>row.id));
 const report:SearchRun={version:1,startedAt:new Date().toISOString(),finishedAt:null,state:'running',scope:options.scope,roles:[...config.roles],documentFocus:options.documentFocus,
 sources:['freehire','web','feeds'].map(name=>({name:name as 'freehire'|'web'|'feeds',status:'pending',code:null,examined:0,added:0,duplicates:0,filtered:0,rejected:0,qualityRejected:0,closed:0,requests:0})),added:0,ready:0,needsCheck:0,modelCalls:0};
 const save=()=>options.save(structuredClone(report));await save();
 for(const source of report.sources){
  if(signal.aborted){source.status='skipped';source.code='DISCOVERY_SEARCH_CANCELLED';await save();continue;}
  source.status='running';await save();
  try{
   if(source.name==='freehire'){
    const result=await options.freehire({scope:options.scope,earlyCareer:config.earlyCareer,page:1,includeUnlabelled:options.includeUnlabelled,categories:discoveryCategories(config.roles)},signal);
    const imported=await importFreehireJobs(store,result.rows,config,options.scope);
    Object.assign(source,{examined:result.examined,added:imported.added,duplicates:imported.duplicates,filtered:imported.filtered,rejected:result.rejected,qualityRejected:imported.qualityRejected,closed:imported.closed,requests:result.cached?0:1});
   }else if(source.name==='web'){
    if(!options.web){source.status='skipped';source.code='DISCOVERY_SEARCH_NOT_ENABLED';await save();continue;}
    const criteria={roles:config.roles,earlyCareer:config.earlyCareer,locations:options.scope==='turkey'?['Türkiye','Turkey','Istanbul']:['Remote'],mode:'jobs' as const};
    const available=await options.web.status(criteria);
    if(!available.cached && (!available.clockValid || available.waitSeconds || available.remainingToday<available.requestsPerRun || available.remainingMonth<available.requestsPerRun)){
     source.status='skipped';source.code=!available.clockValid?'DISCOVERY_SEARCH_CLOCK_INVALID':available.waitSeconds?'DISCOVERY_SEARCH_COOLDOWN':'DISCOVERY_SEARCH_QUOTA_STOP';await save();continue;
    }
    const result=await options.web.run(criteria,signal),imported=await importSearchJobs(store,result.hits,config);
    Object.assign(source,{examined:result.examined,added:imported.added,duplicates:imported.duplicates,filtered:imported.filtered,rejected:result.rejected,requests:result.requests});
    if(result.partial){source.status='partial';source.code=result.failureCode??'DISCOVERY_SEARCH_INCOMPLETE';}
   }else{
    if(!config.sources.length){source.status='skipped';source.code='DISCOVERY_SOURCES_REQUIRED';await save();continue;}
    const result=await options.feeds(signal);
    for(const row of result.sources){source.added+=row.added;source.duplicates+=row.duplicates;source.filtered+=row.filtered;source.rejected+=row.rejected;source.examined+=row.added+row.duplicates+row.filtered+row.rejected;}
    if(result.sources.some(row=>row.code)){source.status='partial';source.code=result.sources.find(row=>row.code)?.code??'DISCOVERY_SOURCE_FAILED';}
   }
   if(source.status==='running')source.status='completed';
  }catch(error){source.status='failed';source.code=signal.aborted?'DISCOVERY_SEARCH_CANCELLED':safe(error);}
  report.added=store.list({includeTrashed:true}).filter(row=>!before.has(row.id) && row.discovery).length;await save();
 }
 const added=store.list().filter(row=>!before.has(row.id) && row.discovery);let checked=0;
 for(const record of added){
  if(options.documentFocus==='finance')await store.update(record.id,current=>({...current,documentFocus:'finance'}));
  if(signal.aborted || checked>=5 || !jobQuality(record).canCheck)continue;
  try{await options.check(record.id,signal);}catch{/* Result remains unchecked; never invent availability. */}checked++;
 }
 const latest=added.map(record=>store.get(record.id));report.added=latest.length;
 report.ready=latest.filter(record=>{
  const result=jobQuality(record,config.earlyCareer);
  return result.bucket==='review' && !searchFilterReason(record.posting.title,record.posting.text,config);
 }).length;
 report.needsCheck=report.added-report.ready;report.finishedAt=new Date().toISOString();
 report.state=signal.aborted?'cancelled':report.sources.every(source=>source.status==='completed')?'completed':'partial';await save();return report;
}

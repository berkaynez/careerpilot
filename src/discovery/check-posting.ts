import { jobLink } from '../jobs/links.js';
import { officialSource } from './quality.js';
import { createSourceReader, sourceKey } from './sources.js';
import type { SourceReader } from './sources.js';
import type { HubRecord } from '../hub/store.js';
/** Reuse fixed public ATS readers. Errors or rejected rows never prove closure. No arbitrary URL fetches. */
export function createPostingChecker(reader:SourceReader=createSourceReader(),now=()=>new Date()) {
  const cache=new Map<string,{at:number;data:Awaited<ReturnType<SourceReader>>|null}>();
  return async(record:HubRecord,signal:AbortSignal)=>{
    const source=officialSource(record);if(!source)throw new Error('DISCOVERY_CHECK_UNSUPPORTED');
    const at=now().toISOString(),key=sourceKey(source),saved=cache.get(key);
    let data=saved && now().getTime()>=saved.at && now().getTime()-saved.at<120_000?saved.data:undefined;
    if(data===undefined){
      try{data=await reader(source,signal);}catch{data=null;}
      if(cache.size>=20)cache.clear();cache.set(key,{at:now().getTime(),data});
    }
    const target=jobLink(record.discovery?.search?.originalURL??record.posting.sourceUrl).url;
    const job=data?.jobs.find(job=>jobLink(job.url).url===target)??null;
    return {check:{status:job?'open' as const:data && !data.rejected?'not_listed' as const:'unavailable' as const,at},job};
  };
}

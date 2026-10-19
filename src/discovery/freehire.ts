import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { jobLink } from '../jobs/links.js';
import { plain } from './sources.js';
import { careerLevel } from './level.js';
import { searchFilterReason } from './job-results.js';
import type { DiscoveryConfig } from './core.js';
import type { openHubStore } from '../hub/store.js';

export const freehireCriteria = z.strictObject({scope:z.enum(['turkey','remote']), earlyCareer:z.boolean(), page:z.number().int().min(1).max(10)});
const rowSchema = z.object({public_slug:z.string().regex(/^[a-z0-9][a-z0-9-]{0,199}$/), title:z.string().min(1).max(1200),
  url:z.string().max(2000).optional(), company:z.string().max(1200).nullable().optional(), description:z.string().max(24000).nullable().optional(),
  location:z.string().max(24000).nullable().optional(), countries:z.array(z.string().max(3)).max(100).default([]),
  work_mode:z.string().nullable().optional(), posted_at:z.string().max(160).nullable().optional(), closed_at:z.string().nullable().optional()});
export type FreehireRow = z.infer<typeof rowSchema>;
/** Public fixed endpoint only. No account, key, model, profile, redirects or automatic retries. */
export function createFreehireSearch(request:typeof fetch=fetch, now=()=>Date.now()) {
  let busy=false, nextAt=0;
  const cache=new Map<string,{at:number; result:{rows:FreehireRow[];total:number;examined:number;rejected:number}}>();
  return async (raw:z.input<typeof freehireCriteria>, signal:AbortSignal) => {
    const criteria=freehireCriteria.parse(raw), key=JSON.stringify(criteria), saved=cache.get(key);
    if(saved && now()>=saved.at && now()-saved.at<600_000) return {...structuredClone(saved.result),cached:true};
    if(busy) throw new Error('DISCOVERY_BUSY');
    if(now()<nextAt) throw new Error('DISCOVERY_FREEHIRE_COOLDOWN');
    busy=true; nextAt=now()+30_000;
    try {
      const url=new URL('https://freehire.me/api/v1/agent/jobs/search');
      url.search=new URLSearchParams({limit:'30',offset:String((criteria.page-1)*30),posted_within_days:'30',description_format:'text',
        ...(criteria.scope==='turkey'?{countries:'TR'}:{work_mode:'remote'}),...(criteria.earlyCareer?{seniority:'junior'}:{})}).toString();
      let response:Response;
      try { response=await request(url,{redirect:'error',credentials:'omit',headers:{Accept:'application/json'},signal:AbortSignal.any([signal,AbortSignal.timeout(20_000)])}); }
      catch { throw new Error('DISCOVERY_FREEHIRE_NETWORK'); }
      if(!response.ok) {await response.body?.cancel(); if(response.status===429) nextAt=now()+300_000; throw new Error(response.status===429?'DISCOVERY_FREEHIRE_RATE_LIMITED':'DISCOVERY_FREEHIRE_HTTP');}
      if(!response.headers.get('content-type')?.includes('application/json') || !response.body) {await response.body?.cancel();throw new Error('DISCOVERY_FREEHIRE_FORMAT');}
      const reader=response.body.getReader(), chunks:Uint8Array[]=[]; let size=0;
      try {while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>4_000_000)throw new Error('DISCOVERY_FREEHIRE_RESPONSE_TOO_LARGE');chunks.push(part.value);}}
      catch(error){if(error instanceof Error && error.message==='DISCOVERY_FREEHIRE_RESPONSE_TOO_LARGE')throw error;throw new Error('DISCOVERY_FREEHIRE_NETWORK');}
      finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      let payload:unknown;try{payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('DISCOVERY_FREEHIRE_FORMAT');}
      const envelope=z.object({data:z.array(z.unknown()).max(30),meta:z.object({total:z.number().int().nonnegative()})}).safeParse(payload);
      if(!envelope.success)throw new Error('DISCOVERY_FREEHIRE_FORMAT');
      const rows:FreehireRow[]=[];let rejected=0;
      for(const raw of envelope.data.data){const parsed=rowSchema.safeParse(raw);if(!parsed.success){rejected++;continue;}rows.push(parsed.data);}
      const result={rows,total:envelope.data.meta.total,examined:envelope.data.data.length,rejected};
      if(cache.size>=20) cache.clear(); cache.set(key,{at:now(),result});
      return {...structuredClone(result),cached:false};
    }finally{busy=false;}
  };
}
export async function importFreehireJobs(store:Awaited<ReturnType<typeof openHubStore>>, rows:FreehireRow[], config:DiscoveryConfig, scope:'turkey'|'remote', now=()=>new Date()) {
  const known=new Set(store.list().flatMap(row=>[row.posting.sourceUrl,...(row.discovery?.search?.originalURL?[row.discovery.search.originalURL]:[])]));
  const report={added:0,duplicates:0,filtered:0,closed:0,modelCalls:0};
  for(const raw of rows){const row=rowSchema.parse(raw), url='https://freehire.me/jobs/'+row.public_slug;
    if(row.closed_at){report.closed++;continue;}
    let originalURL:string|null=null;try{if(row.url) originalURL=jobLink(row.url).url;}catch{/* Unsupported employer URLs are not followed. */}
    if(known.has(url) || originalURL && known.has(originalURL)){report.duplicates++;continue;}
    const title=plain(row.title), text=plain(row.description??'');
    if(!title || text.length<20 || (scope==='turkey'?!row.countries.some(value=>value.toUpperCase()==='TR'):row.work_mode!=='remote') || searchFilterReason(title,text,config)){report.filtered++;continue;}
    const id=randomUUID(), at=now().toISOString();
    await store.add({version:1,id,posting:{version:1,id,company:plain(row.company??'')||'Şirket doğrulanmalı',title,text,
      sourceUrl:url,country:'ZZ',language:'en',documentLanguage:null,photoPolicy:'unspecified',sponsorship:'not_stated',checkedOn:at.slice(0,10)},
      state:'review',createdAt:at,updatedAt:at,analysis:null,lastError:null,
      discovery:{sourceKey:'search:freehire',externalId:row.public_slug,discoveredAt:at,location:plain(row.location??''),remote:row.work_mode==='remote',routingConfirmed:false,
        careerLevel:careerLevel({title,text}).level,reasons:['FreeHire kaynak metni; şirket, ülke/dil ve açık ilan durumu kullanıcı tarafından kontrol edilmeli.'],
        search:{provider:'freehire',originalURL,query:scope==='turkey'?'Türkiye · son 30 gün':'Global remote · son 30 gün',snippet:text.slice(0,3000),dateHint:row.posted_at??null,verified:false}}});
    known.add(url);if(originalURL)known.add(originalURL);report.added++;
  }
  return report;
}

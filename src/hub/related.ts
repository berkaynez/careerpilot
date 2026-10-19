import {normalizeRole,containsTerm} from '../discovery/role-profiles.js';
import type {HubRecord} from './store.js';
const title=(value:string)=>normalizeRole(value.replace(/\s*[([](?:remote|hybrid|on[- ]site)[)\]]\s*$/i,'').replace(/\s+(?:remote|hybrid|flexible hours)\s*$/i,'')).replace(/\bfull stack\b/g,'fullstack').replace(/\b(jr|junior|new grad|new graduate|yeni mezun)\b/g,'entry').replace(/\s+/g,' ').trim();
/** Possible related postings only; never merge records, inherit status, or infer eligibility. */
export function relatedJobs(record:HubRecord, records:HubRecord[]) {
  const company=normalizeRole(record.posting.company), a=title(record.posting.title);
  if(!company || company===normalizeRole('Şirket doğrulanmalı')) return [];
  return records.filter(other=>{
    if(other.id===record.id || normalizeRole(other.posting.company)!==company) return false;
    if(record.posting.country!=='ZZ' && other.posting.country!=='ZZ' && record.posting.country!==other.posting.country) return false;
    const b=title(other.posting.title);
    return a===b || Math.min(a.split(' ').length,b.split(' ').length)>=3 && (containsTerm(a,b)||containsTerm(b,a));
  }).sort((a,b)=>Number(b.state==='submitted')-Number(a.state==='submitted'))
    .map(other=>({id:other.id,title:other.posting.title,state:other.state}));
}

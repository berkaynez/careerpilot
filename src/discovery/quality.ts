import { z } from 'zod';
import { jobLink } from '../jobs/links.js';
import { careerLevel } from './level.js';
import type { HubRecord } from '../hub/store.js';
import type { Source } from './sources.js';

export const provenanceSchema = z.strictObject({
  source: z.string().max(160).nullable(), firstSeenAt: z.string().max(160).nullable(),
  postedAt: z.string().max(160).nullable(), ageDays: z.number().nonnegative().nullable(), fakeFreshness: z.boolean(),
});
export const sourceCheckSchema = z.strictObject({ status: z.enum(['open','not_listed','unavailable']), at: z.iso.datetime() });
export function officialSource(record: HubRecord): Source | null {
  try {
    const link=jobLink(record.discovery?.search?.originalURL ?? record.posting.sourceUrl);
    if(link.platform!=='lever' && link.platform!=='greenhouse') return null;
    return {provider:link.platform,board:new URL(link.url).pathname.split('/')[1]!,company:record.posting.company.slice(0,120)};
  } catch { return null; }
}
/** Content completeness is a cheap intake check, not proof that a job or employer is legitimate. */
export function plausibleCompanyName(value:string){return Boolean(value.trim()) && value!=='Şirket doğrulanmalı' && !/(?:https?:|[a-z0-9-]+\.[a-z]{2,}\/)/i.test(value);}
export function completeDescription(text:string) { return text.length>=200 && text.split(/\s+/).filter(Boolean).length>=30; }
export function freshnessProblem(provenance:z.infer<typeof provenanceSchema>|null|undefined, now:Date):string|null {
  if(!provenance)return null;
  if(provenance.fakeFreshness)return 'Kaynak, eski ilanın yeni tarih ile sunulduğunu bildiriyor.';
  const dates=[provenance.firstSeenAt,provenance.postedAt].filter((v):v is string=>Boolean(v)).map(Date.parse).filter(Number.isFinite);
  if(dates.some(date=>date>now.getTime()+86_400_000))return 'Kaynak tarihi gelecekte; güncellik doğrulanamadı.';
  if((provenance.ageDays??0)>30 || dates.some(date=>now.getTime()-date>30*86_400_000))return 'Kaynakta ilk görülme veya yayın tarihi 30 günden eski.';
  return null;
}
export function jobQuality(record:HubRecord, earlyCareer=true, now=new Date()) {
  const d=record.discovery, reasons:string[]=[], canCheck=Boolean(officialSource(record));
  const result=(bucket:'review'|'check'|'excluded',label:string)=>({bucket,label,reasons,canCheck,checkedAt:d?.sourceCheck?.at??null});
  if(!d)return result('review','Elle eklenen ilan');
  if(earlyCareer && careerLevel(record.posting).level==='experienced')reasons.push('İlanda başlangıç hedefinin üzerinde deneyim/kıdem şartı var.');
  if(d.search?.provider==='freehire' && !plausibleCompanyName(record.posting.company))reasons.push('Kaynak şirket adını vermedi veya şirket yerine bir bağlantı döndürdü.');
  if(!completeDescription(record.posting.text))reasons.push('Açıklama kısa veya eksik; tam ilan metni gerekli.');
  if(/^whatjobs(?:-|$)/i.test(d.provenance?.source??'') && !d.search?.verified && d.sourceCheck?.status!=='open')reasons.push('İlan dolaylı bir toplayıcıdan geldi; asıl işveren kaynağı doğrulanmalı.');
  const stale=freshnessProblem(d.provenance,now);if(stale)reasons.push(stale);
  if(d.sourceCheck?.status==='not_listed')reasons.push('İlan resmî kaynağın mevcut listesinde bulunamadı; kapandığı kesinleştirilmedi.');
  if(reasons.length)return result('excluded','Kalite kontrolünü geçmedi');
  const checked=d.sourceCheck;
  if(checked?.status==='open' && now.getTime()>=Date.parse(checked.at) && now.getTime()-Date.parse(checked.at)<86_400_000) {
    reasons.push('İlan son 24 saatte resmî işveren akışında bulundu. Bu, yayın tarihi veya aday uygunluğu kanıtı değildir.');
    return result('review','Resmî kaynakta mevcut');
  }
  // A human verification remains distinct from a fresh automated employer check.
  if(d.search?.verified || !d.search && d.routingConfirmed) {
    reasons.push('İlan bilgileri kullanıcı tarafından doğrulandı; otomatik açıklık kontrolü güncel değil.');
    return result('review','Kullanıcı doğruladı');
  }
  reasons.push(checked?.status==='unavailable'?'Resmî kaynak okunamadı; kapalı ilan sayılmadı.':'İşveren kaynağında güncel açıklık henüz doğrulanmadı.');
  if(!canCheck)reasons.push('Bu bağlantı için otomatik kaynak kontrolü yok; ilanı açarak kontrol et.');
  return result('check','Kaynak kontrolü gerekiyor');
}

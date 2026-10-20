import type { DiscoveredJob } from './sources.js';
export type CareerLevel = 'entry' | 'experienced' | 'unclear';
const normal = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i');
/** Transparent screening rules, not a claim about the applicant's qualifications. */
export function careerLevel(job: Pick<DiscoveredJob, 'title' | 'text'>): { level: CareerLevel; reason: string } {
  const title = normal(job.title), text = normal(job.text);
  if (/\b(senior|sr\.?|lead|principal|staff|director|manager|supervisor|head|chief|intermediate|mid[ -]level|distinguished)\b/.test(title)
    || /\b(kidemli|yonetici|mud[uü]r)\b/.test(title))
    return { level: 'experienced', reason: 'Başlıkta başlangıç seviyesinin üzerinde bir rol belirtiliyor.' };
  const minimum = /(?:(?:at least|minimum(?: of)?|en az)\s+)?(\d{1,2})(?:\s*[-–]\s*\d{1,2})?\s*\+?\s*(?:years?\s+(?:of\s+)?(?:(?:relevant|professional|commercial|working|hands-on)\s+)?experience|yil(?:lik)?\s+(?:deneyim|tecrube))/g;
  for (const match of text.matchAll(minimum)) {
    const before=text.slice(0,match.index), after=text.slice(match.index!+match[0].length);
    const prefix=before.slice(Math.max(before.lastIndexOf('.'),before.lastIndexOf(';'),before.lastIndexOf('!'))+1);
    const suffix=after.split(/[.;!]/)[0]??'';
    const clause=(prefix.split(/\b(?:and|but|ve|ancak)\b/).pop()??'')+' '+match[0]+' '+suffix.split(/\b(?:and|but|ve|ancak)\b/)[0];
    if(/our company|our team|we have|we bring|sirketimiz|ekibimiz/.test(prefix) && !/you|candidate|require|must|aranan|aday/.test(clause))continue;
    if(Number(match[1])>=3 && !/preferred|nice.to.have|desirable|a plus|tercih|avantaj/.test(clause))
      return {level:'experienced',reason:'Açıklamada '+match[1]+' yıl veya üzeri deneyim şartı var; başlangıç hedefinin üzerinde.'};
  }
  if (/\b(junior|jr\.?|new[ -]grad(?:uate)?|entry[ -]level|graduate|trainee|intern)\b/.test(title) || /yeni mezun|uzman yardimcisi/.test(title))
    return { level: 'entry', reason: 'Başlıkta yeni mezun / başlangıç seviyesi ifadesi var; diğer şartlar ayrıca kontrol edilmeli.' };
  return { level: 'unclear', reason: 'Seviye açık değil; deneyim şartları kontrol edilmeli. Bu ilan junior kabul edilmedi.' };
}

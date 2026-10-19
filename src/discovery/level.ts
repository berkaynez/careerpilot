import type { DiscoveredJob } from './sources.js';
export type CareerLevel = 'entry' | 'experienced' | 'unclear';
const normal = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i');
/** Transparent screening rules, not a claim about the applicant's qualifications. */
export function careerLevel(job: Pick<DiscoveredJob, 'title' | 'text'>): { level: CareerLevel; reason: string } {
  const title = normal(job.title), text = normal(job.text);
  if (/\b(senior|sr\.?|lead|principal|staff|director|manager|intermediate|mid[ -]level|distinguished)\b/.test(title)
    || /\b(kidemli|yonetici|mud[uü]r)\b/.test(title))
    return { level: 'experienced', reason: 'Başlıkta başlangıç seviyesinin üzerinde bir rol belirtiliyor.' };
  // Explicit minimums only. Optional/ambiguous statements remain reviewable.
  const minimum = /(?:at least|minimum(?: of)?|en az)\s+(\d{1,2})\s*(?:\+\s*)?(?:years?\s+(?:of\s+)?(?:relevant\s+|professional\s+|commercial\s+|working\s+)?experience|y[ıi]l\s+(?:deneyim|tecrube))/g;
  for (const match of text.matchAll(minimum)) {
    const from = Math.max(0, match.index! - 60), to = match.index! + match[0].length + 60;
    const context = text.slice(from, to);
    if (Number(match[1]) >= 3 && !/preferred|nice.to.have|desirable|a plus|tercih|avantaj/.test(context))
      return { level: 'experienced', reason: 'Açıklamada en az ' + match[1] + ' yıl deneyim ifadesi var; başlangıç hedefinin üzerinde.' };
  }
  if (/\b(junior|jr\.?|new[ -]grad(?:uate)?|entry[ -]level|graduate|trainee|associate)\b/.test(title) || /yeni mezun|uzman yardimcisi/.test(title))
    return { level: 'entry', reason: 'Başlıkta yeni mezun / başlangıç seviyesi ifadesi var; diğer şartlar ayrıca kontrol edilmeli.' };
  return { level: 'unclear', reason: 'Seviye açık değil; deneyim şartları kontrol edilmeli. Bu ilan junior kabul edilmedi.' };
}

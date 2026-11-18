import { renderCoverLetter } from './letters.js';
import type { Job, Profile } from './core.js';

export function applicationDraft(profile: Profile, job: Pick<Job,'company'|'title'|'language'|'documentLanguage'>, ids: string[]) {
  const language=job.documentLanguage ?? job.language;
  const byId=new Map(profile.facts.map(fact=>[fact.id,fact]));
  const unique=[...new Set(ids)];
  const facts=unique.map(id=>byId.get(id));
  if (!facts.length || facts.some(fact=>!fact)) throw new Error('PREP_DRAFT_EVIDENCE_REQUIRED');
  const {coverLetter,financeLetterFactIds,...candidate}=profile;
  const statements=[...new Set(facts.map(fact=>fact!.text[language]))];
  const cv=[
    profile.contact.name, [profile.contact.email,profile.contact.phone,profile.contact.location].join(' | '),'',
    language==='tr'?'İlgili deneyim ve projeler':'Relevant experience and projects',
    ...statements.map(text=>'- '+text),
  ].join('\n');
  const letter=renderCoverLetter(candidate,job,{coverLetterFactIds:unique.slice(0,4)}).content;
  return {cv,letter};
}

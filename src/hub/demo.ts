import { profileSchema, jobSchema, validatePlan } from '../preparation/core.js';
import type { HubRecord } from './store.js';
import { postingSchema } from '../preparation/posting.js';

/** Entirely fictional; never mixed into the user's real hub directory. */
export const demoProfile = profileSchema.parse({ version: 1,
  contact: { name: 'Örnek Aday', email: 'ornek@example.invalid', phone: '+90 555 000 0000', location: 'İstanbul' },
  preferences: { countries: ['TR'], roles: ['Yazılım', 'Veri analizi'], authorizedCountries: ['TR'], sponsorshipRequiredElsewhere: true },
  facts: [
    { id: 'degree', text: { tr: 'Yönetim bilişim sistemleri lisans mezuniyeti.', en: 'Management information systems degree.' }, source: 'fictional demo' },
    { id: 'web', text: { tr: 'Akademik projede JavaScript ve React ile arayüz geliştirme.', en: 'Academic interface project using JavaScript and React.' }, source: 'fictional demo' },
    { id: 'sql', text: { tr: 'Ders projelerinde SQL sorguları ve veri analizi.', en: 'SQL queries and data analysis in coursework.' }, source: 'fictional demo' },
  ], cvs: [{ id: 'demo-en', language: 'en', photo: true, path: '/fictional/cv.pdf' }, { id: 'demo-tr', language: 'tr', photo: true, path: '/fictional/cv-tr.pdf' }],
});
export function demoRecords(): HubRecord[] {
  const now = new Date().toISOString();
  const posting = postingSchema.parse({ version: 1, id: 'cfa901a0-fcef-4a7a-a49a-5b9f4dc77d31',
    company: 'Atlas Teknoloji · Örnek', title: 'Junior Frontend Developer', country: 'TR', language: 'en',
    sourceUrl: 'https://example.invalid/jobs/frontend', checkedOn: '2026-10-18',
    text: 'Relevant degree. JavaScript knowledge. React experience preferred. Collaborate with the product team.' });
  const { text, ...metadata } = posting;
  const job = jobSchema.parse({ ...metadata, requirements: [
    { id: 'degree', text: 'Relevant degree.', priority: 'essential' },
    { id: 'js', text: 'JavaScript knowledge.', priority: 'essential' },
    { id: 'react', text: 'React experience preferred.', priority: 'preferred' },
    { id: 'team', text: 'Collaborate with the product team.', priority: 'responsibility' },
  ] });
  const plan = validatePlan({ assessments: [
    { requirementId: 'degree', evidenceLevel: 'documented', factIds: ['degree'] },
    { requirementId: 'js', evidenceLevel: 'related', factIds: ['web'] },
    { requirementId: 'react', evidenceLevel: 'related', factIds: ['web'] },
    { requirementId: 'team', evidenceLevel: 'not_documented', factIds: [] },
  ], coverLetterFactIds: ['degree', 'web'], focusRequirementId: 'js' }, demoProfile, job);
  const second = postingSchema.parse({ ...posting, id: '8ea901a0-fcef-4a7a-a49a-5b9f4dc77d32',
    company: 'Meridyen Veri · Örnek', title: 'Junior Data Analyst', language: 'tr',
    sourceUrl: 'https://example.invalid/jobs/analyst', text: 'SQL sorguları hazırlamak, veri raporlarını incelemek ve ekiplerle çalışmak.' });
  return [
    { version: 1, id: posting.id, posting, state: 'ready', createdAt: now, updatedAt: now,
      analysis: { job, plan, origin: 'demo', at: now, costMicroUsd: null }, lastError: null, discovery: null, trashedAt: null, tracking: null },
    { version: 1, id: second.id, posting: second, state: 'saved', createdAt: now, updatedAt: now, analysis: null, lastError: null, discovery: null, trashedAt: null, tracking: null },
  ];
}

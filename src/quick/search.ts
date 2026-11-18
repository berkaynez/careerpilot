import { z } from 'zod';
import { careerLevel } from '../discovery/level.js';
import { containsTerm, normalizeRole } from '../discovery/role-profiles.js';
import { freshnessProblem } from '../discovery/quality.js';
import type { FreehireRow } from '../discovery/freehire.js';

export const roleNames = {
  software: 'Yazılım geliştirici', business: 'IT iş analisti',
  data: 'Veri analisti', support: 'IT uzmanı',
};
const aliases = {
  software: ['software engineer','software developer','developer','yazılım geliştirici','yazılım mühendisi','backend engineer','frontend engineer'],
  business: ['business analyst','iş analisti','business systems analyst'],
  data: ['data analyst','veri analisti','data analytics analyst'],
  support: ['IT specialist','IT support','IT operations','bilgi işlem','bilgi teknolojileri uzmanı','BT uzmanı','uygulama destek','IT uzmanı'],
};
export const preferences = z.strictObject({
  roles: z.array(z.enum(['software','business','data','support'])).min(1).max(4),
  city: z.string().trim().min(1).max(80), office: z.boolean(), hybrid: z.boolean(), remote: z.boolean(),
  junior: z.boolean(),
}).refine(value => value.office || value.hybrid || value.remote);
export type Preferences = z.infer<typeof preferences>;
export const defaults: Preferences = {roles:['software','business','data','support'], city:'İstanbul',office:true,hybrid:true,remote:true,junior:true};

export function filterJobs(rows: FreehireRow[], prefs: Preferences) {
  const jobs = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.closed_at || seen.has(row.public_slug) || !row.countries.some(c => c.toUpperCase()==='TR')) continue;
    if (freshnessProblem({source:null, firstSeenAt:row.created_at??null, postedAt:row.posted_at??null,
      ageDays:row.reality?.age_days??null, fakeFreshness:row.reality?.fake_freshness??false},new Date())) continue;
    const role = prefs.roles.find(key => aliases[key].some(term => containsTerm(row.title, term)));
    if (!role) continue;
    const mode = normalizeRole(row.work_mode ?? '');
    const cityMatches = containsTerm(row.location ?? '', prefs.city);
    const office = ['office','onsite','on site','in office'].includes(mode);
    const local = cityMatches && ((prefs.office && office) || (prefs.hybrid && mode==='hybrid'));
    const needsMode = cityMatches && !office && mode!=='hybrid' && mode!=='remote' && (prefs.office || prefs.hybrid);
    if (!local && !needsMode && !(prefs.remote && mode==='remote')) continue;
    const level = careerLevel({title:row.title,text:row.description??''}).level;
    if (prefs.junior && level==='experienced') continue;
    seen.add(row.public_slug);
    jobs.push({title:row.title, company:row.company || '', location:row.location || 'Türkiye',
      mode:needsMode?'Çalışma biçimini kontrol et':mode, level,
      url:'https://freehire.me/jobs/'+encodeURIComponent(row.public_slug)});
  }
  return jobs;
}

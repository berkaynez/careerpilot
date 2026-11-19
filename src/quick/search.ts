import { z } from 'zod';
import { careerLevel } from '../discovery/level.js';
import { accountingTitle, containsTerm, normalizeRole } from '../discovery/role-profiles.js';
import { freshnessProblem } from '../discovery/quality.js';
import type { FreehireRow } from '../discovery/freehire.js';

export const roleNames = {
  software: 'Yazılım geliştirici', business: 'IT iş analisti',
  data: 'Veri analisti', support: 'IT uzmanı',
  audit: 'BT denetimi / teknoloji riski', product: 'FinTech / ürün analisti',
  security: 'Siber güvenlik', finance: 'Finansal analist',
  externalAudit: 'Bağımsız denetim', project: 'Proje koordinatörü',
};
const aliases: Record<keyof typeof roleNames, string[]> = {
  software: ['software engineer','software developer','developer','yazılım geliştirici','yazılım mühendisi','backend engineer','frontend engineer','back end engineer','full stack engineer','fullstack engineer','application engineer'],
  business: ['business analyst','iş analisti','business systems analyst'],
  data: ['data analyst','veri analisti','data analytics analyst','data and monetization analyst','analytics specialist'],
  support: ['IT specialist','IT support','IT operations','bilgi işlem','bilgi teknolojileri uzmanı','BT uzmanı','uygulama destek','IT uzmanı','technical support specialist','systems administrator','system administrator','service desk','help desk','teknik destek uzmanı'],
  audit: ['IT auditor', 'IT audit', 'BT denetim', 'technology risk', 'technology assurance'],
  product: ['product analyst', 'ürün analisti', 'fintech analyst', 'payment analyst'],
  security: ['cybersecurity analyst', 'cyber security analyst', 'security analyst', 'siber güvenlik', 'SOC analyst'],
  finance: ['finance analyst', 'financial planning analyst', 'financial analyst', 'finansal analist', 'finans analisti', 'FP&A analyst'],
  externalAudit: ['audit associate', 'audit assistant', 'audit trainee', 'denetçi yardımcısı', 'bağımsız denetim'],
  project: ['project coordinator', 'proje koordinatörü', 'project assistant'],
};
export const preferences = z.strictObject({
  roles: z.array(z.enum(Object.keys(roleNames) as (keyof typeof roleNames)[])).min(1).max(Object.keys(roleNames).length),
  city: z.string().trim().min(1).max(80), office: z.boolean(), hybrid: z.boolean(), remote: z.boolean(),
  junior: z.boolean(), includeUnclear: z.boolean().default(false),
}).refine(value => value.office || value.hybrid || value.remote);
export type Preferences = z.infer<typeof preferences>;
export const defaults: Preferences = {roles:['software','business','data','support'], city:'İstanbul',office:false,hybrid:true,remote:true,junior:true,includeUnclear:false};

export type SearchRow = FreehireRow & { employerUrl?: string; sourceName?: string };
export function filterJobs(rows: SearchRow[], prefs: Preferences) {
  const jobs = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (accountingTitle(row.title) || row.closed_at || seen.has(row.public_slug) || !row.countries.some(c => c.toUpperCase()==='TR')) continue;
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
    if (prefs.junior && (level==='experienced' || level==='unclear' && !prefs.includeUnclear)) continue;
    seen.add(row.public_slug);
    jobs.push({role:roleNames[role], documentFocus:role==='finance'||role==='externalAudit'?'finance':'general', source:row.sourceName??'FreeHire', title:row.title, company:row.company || '', description:row.description??'', location:row.location || 'Türkiye',
      mode:needsMode?'Çalışma biçimini kontrol et':mode, level,
      url:row.employerUrl ?? 'https://freehire.me/jobs/'+encodeURIComponent(row.public_slug)});
  }
  return jobs;
}

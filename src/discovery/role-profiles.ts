/** Search vocabulary only: aliases never become claims about applicant skills. */
const groups = [
  ['software engineer', 'software developer', 'yazılım geliştirici', 'yazılım mühendisi'],
  ['data analyst', 'veri analisti'],
  ['business analyst', 'iş analisti'],
  ['AI engineer', 'yapay zeka mühendisi'],
  ['IT auditor', 'IT audit', 'BT denetim', 'bilgi teknolojileri denetçisi', 'bilgi sistemleri denetimi', 'technology risk', 'technology assurance'],
];
export const roleProfiles = [
  {id:'all-targets',label:'Yazılım + analiz + BT denetimi',roles:['software engineer','developer','data analyst','business analyst','AI engineer','IT audit','BT denetim','technology risk']},
  { id: 'software', label: 'Yazılım geliştirme', roles: [...groups[0]!] },
  { id: 'analysis', label: 'Veri ve iş analizi', roles: [...groups[1]!, ...groups[2]!] },
  { id: 'audit', label: 'BT denetimi', roles: ['IT audit','IT auditor','BT denetim','technology risk','technology assurance'] },
];
export const normalizeRole = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, ' ').trim();
export const containsTerm = (text: string, term: string) => (' ' + normalizeRole(text) + ' ').includes(' ' + normalizeRole(term) + ' ');
export function roleTerms(roles: string[]): string[] {
  const result = new Set(roles);
  for (const role of roles) for (const group of groups)
    if (group.some(alias => normalizeRole(alias) === normalizeRole(role))) for (const alias of group) result.add(alias);
  return [...result];
}

/** Public category facets, used only to focus the source search; qualifications stay unknown. */
export const discoveryCategoryValues=['software_engineering','backend','frontend','fullstack','mobile','qa','data_analytics','business_analysis','ai_engineering','ml_ai','security','finance','product'] as const;
export function discoveryCategories(roles:string[]):(typeof discoveryCategoryValues)[number][] {
  const terms=roleTerms(roles), found=new Set<(typeof discoveryCategoryValues)[number]>();
  const add=(categories:(typeof discoveryCategoryValues)[number][])=>categories.forEach(value=>found.add(value));
  if(terms.some(term=>containsTerm(term,'software')||containsTerm(term,'developer')||containsTerm(term,'yazılım')||containsTerm(term,'frontend')||containsTerm(term,'backend'))) add(['software_engineering','backend','frontend','fullstack','mobile','qa']);
  if(terms.some(term=>containsTerm(term,'data analyst')||containsTerm(term,'veri analisti'))) add(['data_analytics']);
  if(terms.some(term=>containsTerm(term,'business analyst')||containsTerm(term,'iş analisti'))) add(['business_analysis']);
  if(terms.some(term=>containsTerm(term,'AI engineer')||containsTerm(term,'yapay zeka'))) add(['ai_engineering','ml_ai']);
  if(terms.some(term=>containsTerm(term,'audit')||containsTerm(term,'auditor')||containsTerm(term,'denetim')||containsTerm(term,'technology risk')||containsTerm(term,'technology assurance'))) add(['security','finance']);
  if(terms.some(term=>containsTerm(term,'product'))) add(['product']);
  return [...found].sort();
}

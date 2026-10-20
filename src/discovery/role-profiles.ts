/** Search vocabulary only: aliases never become claims about applicant skills. */
const groups = [
  ['software engineer', 'software developer', 'yazılım geliştirici', 'yazılım mühendisi'],
  ['data analyst', 'veri analisti'],
  ['business analyst', 'iş analisti'],
  ['AI engineer', 'yapay zeka mühendisi'],
  ['finance','finans','finansal','financial analyst','financial analysis','financial reporting','financial planning','FP&A','mali işler','bütçe','budget'],
  ['accountant','accounting','muhasebe','ön muhasebe','accounts payable','accounts receivable'],
  ['treasury','hazine'],
  ['banking','bankacılık','credit analyst','kredi analisti'],
  ['audit associate','audit assistant','audit trainee','auditor','denetim','denetçi yardımcısı','bağımsız denetim'],
  ['marketing','pazarlama','marketing analyst','digital marketing','dijital pazarlama'],
  ['IT auditor', 'IT audit', 'BT denetim', 'bilgi teknolojileri denetçisi', 'bilgi sistemleri denetimi', 'technology risk', 'technology assurance'],
];
export const roleProfiles = [
  {id:'finance',label:'Finans ve muhasebe',documentFocus:'finance',roles:['finance','finans','financial analyst','muhasebe','accountant','treasury','hazine','audit associate','banking','denetim']},
  {id:'accounting',label:'Muhasebe ve bağımsız denetim',documentFocus:'finance',roles:['muhasebe','accountant','accounting','accounts payable','accounts receivable','audit associate','denetçi yardımcısı']},
  {id:'marketing',label:'Pazarlama ve ticari analiz',documentFocus:'finance',roles:['marketing','pazarlama','marketing analyst','digital marketing']},
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
export const discoveryCategoryValues=['software_engineering','backend','frontend','fullstack','mobile','qa','data_analytics','business_analysis','ai_engineering','ml_ai','security','finance','product','marketing'] as const;
export function discoveryCategories(roles:string[]):(typeof discoveryCategoryValues)[number][] {
  const terms=roleTerms(roles), found=new Set<(typeof discoveryCategoryValues)[number]>();
  const add=(categories:(typeof discoveryCategoryValues)[number][])=>categories.forEach(value=>found.add(value));
  if(terms.some(term=>containsTerm(term,'software')||containsTerm(term,'developer')||containsTerm(term,'yazılım')||containsTerm(term,'frontend')||containsTerm(term,'backend'))) add(['software_engineering','backend','frontend','fullstack','mobile','qa']);
  if(terms.some(term=>containsTerm(term,'data analyst')||containsTerm(term,'veri analisti'))) add(['data_analytics']);
  if(terms.some(term=>containsTerm(term,'business analyst')||containsTerm(term,'iş analisti'))) add(['business_analysis']);
  if(terms.some(term=>containsTerm(term,'AI engineer')||containsTerm(term,'yapay zeka'))) add(['ai_engineering','ml_ai']);
  if(terms.some(term=>containsTerm(term,'IT audit')||containsTerm(term,'IT auditor')||containsTerm(term,'BT denetim')||containsTerm(term,'bilgi sistemleri denetimi')||containsTerm(term,'bilgi teknolojileri denetçisi')||containsTerm(term,'technology risk')||containsTerm(term,'technology assurance'))) add(['security','finance']);
  if(terms.some(term=>['finance','finans','finansal','accountant','accounting','muhasebe','treasury','hazine','banking','bankacılık','credit analyst','kredi analisti','FP&A','budget','bütçe','mali işler','audit associate','auditor','denetim'].some(role=>containsTerm(term,role)))) add(['finance']);
  if(terms.some(term=>containsTerm(term,'marketing')||containsTerm(term,'pazarlama')))add(['marketing']);
  if(terms.some(term=>containsTerm(term,'product'))) add(['product']);
  return [...found].sort();
}

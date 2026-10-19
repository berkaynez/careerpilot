/** Search vocabulary only: aliases never become claims about applicant skills. */
const groups = [
  ['software engineer', 'software developer', 'yazılım geliştirici', 'yazılım mühendisi'],
  ['data analyst', 'veri analisti'],
  ['business analyst', 'iş analisti'],
  ['AI engineer', 'yapay zeka mühendisi'],
  ['IT auditor', 'IT audit', 'BT denetim', 'bilgi teknolojileri denetçisi'],
];
export const roleProfiles = [
  { id: 'software', label: 'Yazılım geliştirme', roles: [...groups[0]!] },
  { id: 'analysis', label: 'Veri ve iş analizi', roles: [...groups[1]!, ...groups[2]!] },
  { id: 'audit', label: 'BT denetimi', roles: [...groups[4]!] },
];
export const normalizeRole = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, ' ').trim();
export const containsTerm = (text: string, term: string) => (' ' + normalizeRole(text) + ' ').includes(' ' + normalizeRole(term) + ' ');
export function roleTerms(roles: string[]): string[] {
  const result = new Set(roles);
  for (const role of roles) for (const group of groups)
    if (group.some(alias => normalizeRole(alias) === normalizeRole(role))) for (const alias of group) result.add(alias);
  return [...result];
}

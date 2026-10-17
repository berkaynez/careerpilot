import { z } from 'zod';
import type { Profile, Job, Plan } from './core.js';

const text = z.string().trim().min(1).max(650).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const kinds = ['introduction', 'background', 'experience', 'projects'] as const;
export const letterProfileSchema = z.strictObject({
  reviewedOn: z.iso.date(),
  sections: z.array(z.strictObject({
    kind: z.enum(kinds), text: z.strictObject({ tr: text, en: text }),
    factIds: z.array(z.string().regex(/^[a-zA-Z0-9_.-]{1,80}$/)).min(1).max(8),
  })).min(1).max(4),
}).superRefine((letter, context) => {
  const order = letter.sections.map(section => kinds.indexOf(section.kind));
  if (order[0] !== 0 || order.some((value, index) => index > 0 && value <= order[index - 1]!)) {
    context.addIssue({ code: 'custom', message: 'Letter sections must start with introduction and follow candidate-first order' });
  }
  for (const section of letter.sections) {
    if (new Set(section.factIds).size !== section.factIds.length) context.addIssue({ code: 'custom', message: 'Duplicate letter fact IDs' });
    if ((section.kind === 'experience' || section.kind === 'projects')
      && (section.text.tr.length > 450 || section.text.en.length > 450)) {
      context.addIssue({ code: 'custom', message: 'Experience and projects must remain brief' });
    }
  }
});

/** Reviewed local prose is preserved; a model can select references but cannot rewrite this narrative. */
export function renderCoverLetter(profile: Profile, job: Pick<Job, 'company' | 'title' | 'language' | 'documentLanguage'>, plan: Pick<Plan, 'coverLetterFactIds'>) {
  const language = job.documentLanguage ?? job.language;
  const facts = new Map(profile.facts.map(fact => [fact.id, fact]));
  const base = profile.coverLetter;
  const included = new Set(base?.sections.flatMap(section => section.factIds) ?? []);
  const additionalFactIds = plan.coverLetterFactIds.filter(id => !included.has(id)).slice(0, base ? 2 : 4);
  const paragraphs = [
    ...(base?.sections.map(section => section.text[language]) ?? []),
    ...additionalFactIds.map(id => facts.get(id)!.text[language]),
  ];
  const content = language === 'en'
    ? [`Dear ${job.company} Recruitment Team,`,
      `I am applying for the ${job.title} position at ${job.company}.`, ...paragraphs,
      'I would welcome the opportunity to discuss how my background and interests relate to this role. Thank you for considering my application.',
      `Kind regards,\n${profile.contact.name}`].join('\n\n')
    : [`${job.company} İşe Alım Ekibine,`,
      `${job.company} bünyesindeki ${job.title} pozisyonuna başvurmak istiyorum.`, ...paragraphs,
      'Eğitimimi, çalışmalarımı ve pozisyona olan ilgimi bir görüşmede paylaşmak isterim. Başvurumu değerlendirdiğiniz için teşekkür ederim.',
      `Saygılarımla,\n${profile.contact.name}`].join('\n\n');
  return { content, evidence: {
    mode: base ? 'reviewed_profile' as const : 'selected_facts' as const,
    ...(base ? { reviewedOn: base.reviewedOn } : {}),
    sections: base?.sections.map(section => ({ kind: section.kind, factIds: section.factIds })) ?? [],
    additionalFactIds,
  } };
}

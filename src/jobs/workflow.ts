import { createHash } from 'node:crypto';
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { Profile } from '../preparation/core.js';
import { profileSchema, selectCV } from '../preparation/core.js';
import { postingSchema } from '../preparation/posting.js';
import { renderCoverLetter } from '../preparation/letters.js';
import { readPreviewCV } from '../lever/preview.js';
import { openLeverSession } from '../lever/session.js';
import { planLeverDraft, leverAnswersSchema } from '../lever/form.js';
import type { LeverAnswers, LeverForm } from '../lever/form.js';
import { resolveJobLink, browserJobReader } from './intake.js';
import type { PublicJobPage } from './intake.js';
import type { JobLink } from './links.js';
import { applicationTargetSchema } from './target.js';

export interface JobIntakeInput {
  url: string; profile: Profile; answers: LeverAnswers; directory: string;
  country?: string; language?: string; company?: string; title?: string;
  documentLanguage?: string; photoPolicy?: string;
}
export interface JobIntakeDependencies {
  read?: (link: JobLink) => Promise<PublicJobPage>;
  inspect?: (url: string) => Promise<LeverForm>;
}
async function inspect(url: string) {
  const session=await openLeverSession(url);
  try { return session.form; } finally {await session.browser.close();}
}

/** Public read -> private reusable packet. No model, contact filling, file upload or submission. */
export async function createJobPacket(input: JobIntakeInput, dependencies: JobIntakeDependencies = {}) {
  const profile=profileSchema.parse(input.profile), answers=leverAnswersSchema.parse(input.answers);
  const resolution=await resolveJobLink(input.url,dependencies.read ?? browserJobReader());
  await mkdir(dirname(input.directory),{recursive:true,mode:0o700});
  await mkdir(input.directory,{mode:0o700}); await chmod(input.directory,0o700);
  const save = (name: string,value: unknown) => writeFile(join(input.directory,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
  await save('discovery.json',resolution);
  if (resolution.status!=='resolved') {
    await writeFile(join(input.directory,'next-steps.txt'),'İşveren bağlantısı herkese açık sayfadan kesin olarak bulunamadı. İlandaki Başvur düğmesini kendin açıp ulaştığın Lever veya Greenhouse bağlantısını ver. Giriş ekranı veya erişim koruması aşılmadı.\n',{mode:0o600});
    return {status:resolution.status,directory:input.directory,reason:resolution.reason,modelCalls:0,cvUploaded:false,submitted:false} as const;
  }
  const company=input.company ?? resolution.page.company, title=input.title ?? resolution.page.title;
  const missing=[!company?'company':null,!title?'title':null,!input.country?'country':null,!input.language?'language':null].filter(Boolean);
  if (missing.length) return {status:'metadata_required',directory:input.directory,missing,modelCalls:0,cvUploaded:false,submitted:false} as const;
  const metadata=applicationTargetSchema.parse({version:1,id:'job-'+createHash('sha256').update(resolution.employer.url).digest('hex').slice(0,20),company,title,country:input.country,language:input.language,
    documentLanguage:input.documentLanguage ?? null,photoPolicy:input.photoPolicy ?? 'unspecified',sponsorship:'not_stated',
    sourceUrl:resolution.employer.url,checkedOn:new Date().toISOString().slice(0,10)});
  // Never invent qualification requirements just to satisfy a model-oriented job schema.
  const posting=postingSchema.parse({...metadata,text:resolution.page.text});
  const asset=selectCV(profile,metadata), cv=await readPreviewCV(asset.path);
  const letter=renderCoverLetter(profile,metadata,{coverLetterFactIds:profile.coverLetter?[]:profile.facts.slice(0,3).map(fact=>fact.id)});
  await save('application.json',metadata); await save('posting.json',posting);
  await save('answers.json',answers);
  await writeFile(join(input.directory,cv.name),cv.buffer,{flag:'wx',mode:0o600});
  await writeFile(join(input.directory,'cover-letter.txt'),letter.content+'\n',{flag:'wx',mode:0o600});
  let blockers: {name:string;reason:string}[]=[];
  let formLabels=new Map<string,string>();
  let status: 'lever_review_ready' | 'answers_required' | 'manual_application_required'='manual_application_required';
  if (resolution.employer.platform==='lever') {
    const form=await (dependencies.inspect ?? inspect)(metadata.sourceUrl);
    formLabels=new Map(form.fields.map(field=>[field.name,field.label]));
    const draft=planLeverDraft(profile,form,answers);
    await save('form.json',form); await save('draft.json',draft); blockers=draft.blockers;
    status=blockers.some(item=>!['cv_upload_requires_separate_approval','user_decision_required'].includes(item.reason))?'answers_required':'lever_review_ready';
  }
  await save('packet.json',{status,company,title,platform:resolution.employer.platform,sourceUrl:metadata.sourceUrl,
    cv:{file:cv.name,language:asset.language,photo:asset.photo},letter:letter.evidence,
    qualificationAssessment:'not_performed',documentPolicy:'user_supplied_metadata_requires_review',blockers,
    requiresSponsorship:!profile.preferences.authorizedCountries.includes(metadata.country) && profile.preferences.sponsorshipRequiredElsewhere,
    modelCalls:0,personalDataEntered:false,cvUploaded:false,submitted:false});
  await writeFile(join(input.directory,'next-steps.txt'),[
    `${company} — ${title}`,`Platform: ${resolution.employer.platform}`,`CV: ${cv.name}`,
    'Ülke, ilan dili ve varsa özel belge talimatlarını kontrol et. Ön yazı genel aday anlatımıdır; bu ilan için uygunluk analizi yapılmadı.',
    ...blockers.map(item=>`${formLabels.get(item.name) ?? 'Alan'}: ${{cv_upload_requires_separate_approval:'CV yüklemesi için ayrıca onay gerekir',user_decision_required:'kararı/onayı sen vereceksin',missing_required_answer:'bu cevabı kontrolü aldığında sen dolduracaksın',unknown_required_file:'bu ek dosyayı kendin seçmelisin',ambiguous_field:'alan eşleşmesi belirsiz; otomatik doldurma durduruldu',university_option_not_unique:'üniversiteni listeden kendin seçmelisin'}[item.reason] ?? 'otomatik doldurma desteklenmiyor'}`),
    status==='lever_review_ready'?'Lever formu için yerel hazırlık tamamlandı. Gerçek CV yükleme ve açık tarayıcı için ayrıca --review ve paylaşım onayları gerekir.':
      status==='answers_required'?'Ek cevaplar gerekiyor. Gözetimli --review modunda bilinen alanlar hazırlanır; kalan soruları kontrolü aldığında kendin tamamlarsın. Belirsiz alan eşleşmesinde otomatik akış durur.':'Bu platformda otomatik doldurma/yükleme henüz desteklenmiyor. Hazırlanan CV ve ön yazıyı bağlantıdan kendin kullanabilirsin.',
  ].join('\n')+'\n',{flag:'wx',mode:0o600});
  return {status,directory:input.directory,platform:resolution.employer.platform,cvFile:cv.name,modelCalls:0,cvUploaded:false,submitted:false} as const;
}

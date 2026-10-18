import type { Page } from 'playwright';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { inspectPage } from '../browser/inspector.js';
import type { FormControl } from '../contracts.js';
import { profileSchema } from '../preparation/core.js';
import type { Profile } from '../preparation/core.js';
import { leverAnswersSchema } from '../lever/form.js';

const line=z.string().trim().min(1).max(250).refine(value=>!/[\u0000-\u001f\u007f]/.test(value));
const applicationAnswers=z.strictObject({
  url:z.url().refine(value=>{const url=new URL(value);return url.protocol==='https:' && !url.username && !url.password && !url.hash;}),
  noticePeriod:line.optional(),
  salaryExpectation:z.string().regex(/^\d{1,9}(?:\.\d{1,2})?$/).optional(),
});
export const assistAnswersSchema=leverAnswersSchema.extend({firstName:line.optional(),lastName:line.optional(),application:applicationAnswers.optional()});
export type AssistAnswers=z.infer<typeof assistAnswersSchema>;
const normal=(value:string)=>value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i')
  .replace(/\b(required|zorunlu)\b/g,'').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const aliases={
  fullName:['full name','name','name surname','first and last name','ad soyad','adınız soyadınız','isim soyisim'],
  firstName:['first name','given name','ad','adınız','isim'],
  lastName:['last name','surname','family name','soyad','soyadınız','soyisim'],
  email:['email','email address','e mail','e posta','e posta adresi','eposta'],
  phone:['phone','phone number','mobile phone','mobile number','telefon','telefon numarası','cep telefonu'],
  linkedin:['linkedin','linkedin url','linkedin profile','linkedin profiliniz','linkedin profil bağlantısı'],
  github:['github','github url','github profile','github profil bağlantısı'],
  portfolio:['portfolio','portfolio url','portfolio website','portfolyo','portfolyo bağlantısı'],
  noticePeriod:['notice period','what is your notice period','what is your notice period what would be your possible start date','ihbar süresi','ihbar süreniz','ne zaman başlayabilirsiniz'],
  salaryExpectation:['salary expectation','salary expectations','what are your base salary expectations for this role','maaş beklentiniz','maaş beklentisi'],
  university:['university','university college','university name','üniversite','üniversite adı'],
} as const;
type FieldKey=keyof typeof aliases;
function keyFor(control:FormControl):FieldKey | undefined {
  return (Object.keys(aliases) as FieldKey[]).find(key=>aliases[key].some(label=>normal(label)===normal(control.label)));
}
async function inspectApplication(page:Page,id:string,assignIds=true){
  const observation=await inspectPage(page,id,assignIds);
  // A question's accessible name may belong to its surrounding group rather than its input.
  // Use it only for a single editable control; repeated/multi-part groups remain ambiguous.
  for(const control of observation.controls){
    if(control.label || !['text','textarea','select'].includes(control.kind))continue;
    const target=page.locator(`[data-careerpilot-id=${JSON.stringify(control.id)}]`);
    control.label=await target.evaluate(element=>{
      const group=element.closest('[role="group"],fieldset');
      if(!group || group.querySelectorAll('input:not([type="hidden"]),textarea,select,[role="combobox"],button').length!==1)return '';
      const name=group.getAttribute('aria-label');
      if(name)return name;
      return (group.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)
        .map(id=>document.getElementById(id)?.textContent?.trim() ?? '').join(' ');
    });
  }
  return observation;
}

export interface AssistPassResult {
  status:'review_required' | 'needs_information' | 'login_required';
  filled:number; alreadyCorrect:number;
  remaining:{label:string;reason:string}[];
  modelCalls:0; agentSubmitted:false; cvUploadedByAgent:false;
}

/** Caller establishes a write-blocked pass. Never clicks, uploads files, reads credentials or accepts consent. */
export async function fillKnownApplicationFields(page:Page, input:{profile:Profile;answers:AssistAnswers;origin:string;contactApproved:boolean}):Promise<AssistPassResult> {
  if(!input.contactApproved)throw new Error('ASSIST_CONTACT_CONSENT_REQUIRED');
  if(new URL(page.url()).origin!==input.origin)throw new Error('ASSIST_ORIGIN_NOT_APPROVED');
  const profile=profileSchema.parse(input.profile), answers=assistAnswersSchema.parse(input.answers);
  if((answers.firstName || answers.lastName) && (!answers.firstName || !answers.lastName || normal(answers.firstName+' '+answers.lastName)!==normal(profile.contact.name))) throw new Error('ASSIST_NAME_PARTS_NOT_VERIFIED');
  const result:AssistPassResult={status:'review_required',filled:0,alreadyCorrect:0,remaining:[],modelCalls:0,agentSubmitted:false,cvUploadedByAgent:false};
  const login=await page.evaluate(()=>{
    const helpers={
      visible(element:Element){
        if(!element.getClientRects().length || element.closest('[hidden],[inert],[aria-hidden="true"]'))return false;
        for(let ancestor:Element|null=element;ancestor;ancestor=ancestor.parentElement){
          const style=getComputedStyle(ancestor);
          if(style.display==='none' || style.visibility==='hidden' || style.visibility==='collapse' || style.opacity==='0')return false;
        }
        return true;
      },
      authPath(path:string){return /\/(?:auth|login|log-in|signin|sign-in|uye-girisi|giris)(?:\/|$)/i.test(path);},
      authText(text:string){
        const value=text.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i');
        return /\b(?:sign\s*in|log\s*in|create\s+(?:an?\s+)?account|giris\s+yap|hesap\s+olustur|oturum\s+ac)\b/.test(value);
      },
    };
    if(helpers.authPath(location.pathname))return true;
    if(Array.from(document.querySelectorAll('input[type="password"],input[autocomplete="one-time-code"]')).some(helpers.visible))return true;
    if(Array.from(document.querySelectorAll('h1,h2,[role="heading"],[role="dialog"]')).some(element=>helpers.visible(element) && helpers.authText(element.getAttribute('aria-label') ?? element.textContent ?? '')))return true;
    return Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe')).some(frame=>{
      if(!helpers.visible(frame))return false;
      if(helpers.authText(frame.title+' '+(frame.getAttribute('aria-label') ?? '')))return true;
      try{return helpers.authPath(new URL(frame.src,location.href).pathname);}catch{return false;}
    });
  });
  if(login){result.status='login_required';return result;}
  const id='assist-'+randomUUID(), observation=await inspectApplication(page,id);
  const application=answers.application?.url===page.url()?answers.application:undefined;
  const values:Partial<Record<FieldKey,string | undefined>>={fullName:profile.contact.name,firstName:answers.firstName,lastName:answers.lastName,
    noticePeriod:application?.noticePeriod,salaryExpectation:application?.salaryExpectation,
    email:profile.contact.email,phone:profile.contact.phone,linkedin:answers.linkedin,github:answers.github,portfolio:answers.portfolio,university:answers.university};
  const proposed=observation.controls.map(control=>({control,key:keyFor(control)}));
  const counts=new Map<FieldKey,number>();
  for(const {control,key} of proposed)if(key && ['text','textarea','select'].includes(control.kind))counts.set(key,(counts.get(key) ?? 0)+1);
  const expected:{control:FormControl;value:string}[]=[];
  for(const {control,key} of proposed){
    if(application && page.url()!==application.url)throw new Error('ASSIST_APPLICATION_CHANGED');
    if(control.kind==='button')continue;
    if(!key || !values[key] || !['text','textarea','select'].includes(control.kind) || control.inputType && !['text','email','tel','url',...(key==='salaryExpectation'?['number']:[])].includes(control.inputType)) {
      if(control.required || ['checkbox','radio'].includes(control.kind))result.remaining.push({label:control.label,reason:['checkbox','radio'].includes(control.kind)?'human_decision_required':'manual_answer_required'});
      continue;
    }
    if(counts.get(key)!==1){result.remaining.push({label:control.label,reason:'ambiguous_field'});continue;}
    const target=page.locator(`[data-careerpilot-id=${JSON.stringify(control.id)}]`);
    if(await target.count()!==1)throw new Error('ASSIST_STALE_FORM');
    if(await target.getAttribute('role')==='combobox' || await target.getAttribute('aria-autocomplete') || await target.getAttribute('list')) {
      result.remaining.push({label:control.label,reason:'interactive_widget_requires_human'});continue;
    }
    let value=values[key]!;
    if(control.kind==='select'){
      const matching=control.options.filter(option=>normal(option.label)===normal(value));
      if(matching.length!==1){result.remaining.push({label:control.label,reason:'option_not_unique'});continue;}
      const index=control.options.findIndex(option=>option.id===matching[0]!.id);
      const native=await target.locator('option').filter({hasText:new RegExp('^'+matching[0]!.label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')}).all();
      if(index<0 || native.length!==1){result.remaining.push({label:control.label,reason:'option_not_unique'});continue;}
      value=await native[0]!.getAttribute('value') ?? matching[0]!.label;
      const current=await target.inputValue();
      if(current===value){result.alreadyCorrect++;expected.push({control,value});continue;}
      // Only empty placeholder selections may be changed; existing applicant choices are preserved.
      if(current){result.remaining.push({label:control.label,reason:'existing_value_preserved'});continue;}
    }else{
      const current=await target.inputValue();
      if(current===value){result.alreadyCorrect++;expected.push({control,value});continue;}
      if(current){result.remaining.push({label:control.label,reason:'existing_value_preserved'});continue;}
    }
    const fresh=await inspectApplication(page,id,false), same=fresh.controls.find(candidate=>candidate.id===control.id);
    if(new URL(page.url()).origin!==input.origin || !same || same.kind!==control.kind || same.label!==control.label)throw new Error('ASSIST_STALE_FORM');
    if(control.kind==='select')await target.selectOption(value);else await target.fill(value);
    await target.blur();
    expected.push({control,value});result.filled++;
  }
  // Later fields or site event handlers can invalidate earlier values. Verify the entire pass.
  if(application && page.url()!==application.url)throw new Error('ASSIST_APPLICATION_CHANGED');
  const final=await inspectApplication(page,id,false);
  for(const {control,value} of expected){
    const same=final.controls.find(candidate=>candidate.id===control.id);
    if(!same || same.kind!==control.kind || same.label!==control.label)throw new Error('ASSIST_STALE_FORM');
    const target=page.locator(`[data-careerpilot-id=${JSON.stringify(control.id)}]`);
    if(new URL(page.url()).origin!==input.origin || await target.count()!==1 || await target.inputValue()!==value)throw new Error('ASSIST_FINAL_VALUES_NOT_VERIFIED');
    const valid=await target.evaluate(element=>!('validity' in element) || (element as HTMLInputElement).validity.valid);
    if(!valid)result.remaining.push({label:control.label,reason:'site_validation_requires_human'});
  }
  const files=await page.locator('input[type="file"]').evaluateAll(elements=>elements.filter(element=>!element.hasAttribute('disabled')).map(element=>({label:element.getAttribute('aria-label') || 'CV / document',reason:'manual_file_selection_required'})));
  result.remaining.push(...files);
  if(!expected.length && !result.remaining.length)result.remaining.push({label:'Form',reason:'no_matching_fields'});
  if(result.remaining.length)result.status='needs_information';
  return result;
}

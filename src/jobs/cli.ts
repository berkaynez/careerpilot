import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { readLocalJSON } from '../preparation/files.js';
import { profileSchema } from '../preparation/core.js';
import { leverAnswersSchema } from '../lever/form.js';
import { createLeverUploadDraft, requireUploadConsent } from '../lever/upload.js';
import { terminalReview } from '../lever/review.js';
import { createJobPacket } from './workflow.js';
import { applicationTargetSchema } from './target.js';

async function main() {
  const {values,positionals}=parseArgs({allowPositionals:true,options:{
    url:{type:'string'},profile:{type:'string',default:'.careerpilot/profile.json'},answers:{type:'string'},
    country:{type:'string'},language:{type:'string'},company:{type:'string'},title:{type:'string'},
    'document-language':{type:'string'},'photo-policy':{type:'string'},review:{type:'boolean'},
    'approve-contact-sharing':{type:'boolean'},'approve-cv-upload':{type:'boolean'},
  },strict:true});
  const urls=values.url?[values.url,...positionals]:positionals;
  if (!urls.length || urls.length>10 || values.review && urls.length!==1) throw new Error('JOB_ARGUMENTS_INVALID');
  const consent={contactApproved:values['approve-contact-sharing']===true,cvUploadApproved:values['approve-cv-upload']===true};
  if (values.review) {
    requireUploadConsent(consent);
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('LEVER_INTERACTIVE_TERMINAL_REQUIRED');
  }
  const profile=profileSchema.parse(await readLocalJSON(resolve(values.profile!)));
  let answers={};
  const answerPath=resolve(values.answers ?? '.careerpilot/lever-answers.json');
  let answersExist=false;
  try { await access(answerPath); answersExist=true; } catch { if(values.answers)throw new Error('JOB_ANSWERS_UNAVAILABLE'); }
  if (answersExist) answers=leverAnswersSchema.parse(await readLocalJSON(answerPath));
  const stateDir=resolve(process.env.CAREERPILOT_STATE_DIR ?? '.careerpilot');
  let failures=0;
  for (const url of urls) {
    const directory=join(stateDir,'jobs',randomUUID());
    try {
      const result=await createJobPacket({url,profile,answers,directory,
        ...(values.country?{country:values.country}:{}),...(values.language?{language:values.language}:{}),
        ...(values.company?{company:values.company}:{}),...(values.title?{title:values.title}:{}),
        ...(values['document-language']?{documentLanguage:values['document-language']}:{}),
        ...(values['photo-policy']?{photoPolicy:values['photo-policy']}:{}),
      });
      console.log(JSON.stringify(result,null,2));
      if (result.status==='metadata_required') console.log('Eksik bilgiler: '+result.missing.join(', ')+'. --country TR --language en gibi açık seçenekler kullan.');
      if (values.review && (result.status==='lever_review_ready' || result.status==='answers_required')) {
        const job=applicationTargetSchema.parse(await readLocalJSON(join(directory,'application.json')));
        const savedAnswers=leverAnswersSchema.parse(await readLocalJSON(join(directory,'answers.json')));
        console.log(JSON.stringify(await createLeverUploadDraft({profile,job,answers:savedAnswers,directory:join(directory,'browser-review'),consent,review:terminalReview}),null,2));
      } else if (result.status!=='lever_review_ready' && result.status!=='manual_application_required') failures++;
    } catch(error) {
      failures++;
      const code=error instanceof Error && /^(JOB|PREP|LEVER)_[A-Z_]+$/.test(error.message)?error.message:'JOB_WORKFLOW_FAILED';
      console.error(JSON.stringify({code,directory,note:'No automatic upload retry.'}));
    }
  }
  if(failures)process.exitCode=1;
}
void main().catch(error=>{console.error(JSON.stringify({code:error instanceof Error && /^(JOB|PREP|LEVER)_[A-Z_]+$/.test(error.message)?error.message:'JOB_WORKFLOW_FAILED'}));process.exitCode=1;});

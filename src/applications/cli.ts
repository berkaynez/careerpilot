import { chromium } from 'playwright';
import { createInterface } from 'node:readline';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { profileSchema } from '../preparation/core.js';
import { readLocalJSON } from '../preparation/files.js';
import { jobLink } from '../jobs/links.js';
import { assistAnswersSchema, fillKnownApplicationFields } from './fields.js';
import { assistTransport, recognisedAssistOrigin } from './transport.js';

async function main(){
  const {values,positionals}=parseArgs({allowPositionals:true,strict:true,options:{
    help:{type:'boolean'},profile:{type:'string',default:'.careerpilot/profile.json'},answers:{type:'string'},'approve-contact-sharing':{type:'boolean'},
  }});
  if(values.help){
    process.stdout.write('Kullanım: npm run assist -- <ilan-bağlantısı> --approve-contact-sharing\nTarayıcıda giriş ve başvuru sayfasını kendin aç. Terminalde DOLDUR ile bilinen boş alanları doldur; DEVAM ile elle ilerle. CV yükleme, CAPTCHA, onay ve gönderme sana aittir. Ücretli model çağrısı yapılmaz.\nİsteğe bağlı: --profile <dosya> --answers <dosya>\n');return;
  }
  if(positionals.length!==1)throw new Error('ASSIST_ARGUMENTS_INVALID');
  if(!values['approve-contact-sharing'])throw new Error('ASSIST_CONTACT_CONSENT_REQUIRED');
  if(!process.stdin.isTTY || !process.stdout.isTTY)throw new Error('ASSIST_INTERACTIVE_TERMINAL_REQUIRED');
  const link=jobLink(positionals[0]!), profile=profileSchema.parse(await readLocalJSON(resolve(values.profile!)));
  const answerFile=resolve(values.answers ?? '.careerpilot/lever-answers.json');let answers={};
  let exists=false;try{await access(answerFile);exists=true;}catch{if(values.answers)throw new Error('ASSIST_ANSWERS_UNAVAILABLE');}
  if(exists)answers=assistAnswersSchema.parse(await readLocalJSON(answerFile));
  const directory=resolve(process.env.CAREERPILOT_STATE_DIR ?? '.careerpilot','assist-reviews',randomUUID());
  await mkdir(directory,{recursive:true,mode:0o700});
  const events:unknown[]=[];
  const save=()=>writeFile(join(directory,'session.json'),JSON.stringify({version:1,events,modelCalls:0,agentSubmitted:false,cvUploadedByAgent:false,manualOutcome:'unknown'},null,2)+'\n',{mode:0o600});
  await save();
  const browser=await chromium.launch({headless:false});
  const lines=createInterface({input:process.stdin,output:process.stdout,terminal:false});
  browser.on('disconnected',()=>lines.close());
  try{
    const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false});
    const transport=await assistTransport(context);
    let page=await context.newPage();page.setDefaultTimeout(10_000);
    await page.goto(link.url,{waitUntil:'domcontentloaded',timeout:30_000});
    const allowed=new Set([new URL(link.url).origin]);
    process.stdout.write('Tarayıcıda hesabına kendin giriş yapıp başvuru formunu aç. Şifre, CAPTCHA, CV yükleme ve gönderme sana aittir. Oturum kaydedilmez.\n');
    process.stdout.write('DOLDUR: görünür, bilinen boş alanları doldurur ve kontrole bırakır. DEVAM: normal site bağlantılarını açar; sonraki sayfaya kendin geçebilirsin. DEVRET: yardımı bitirir, tarayıcıyı sana bırakır. KAPAT: çıkar. SAYFALAR / SAYFA 2: açılan başka sekmeyi seçer.\n');
    process.stdout.write(`Özel kontrol kaydı: ${directory}\n`);
    for await(const raw of lines){
      const command=raw.trim();
      if(command==='KAPAT')break;
      if(command==='DEVRET'){
        await transport.allowManual();
        process.stdout.write('Kontrol tamamen sende. Program artık alan doldurmayacak veya sonucu izlemeyecek. Bitirince tarayıcı penceresini kapat.\n');
        lines.close();
        if(browser.isConnected())await new Promise<void>(resolve=>browser.once('disconnected',()=>resolve()));
        break;
      }
      if(command==='DEVAM'){
        await transport.allowManual();
        process.stdout.write('Normal site trafiği açık. Gerekli adımları kendin tamamla; sonraki formda yeniden DOLDUR yazabilirsin.\n');continue;
      }
      if(command==='SAYFALAR'){
        context.pages().forEach((tab,index)=>process.stdout.write(`${index+1}: ${new URL(tab.url()).origin}\n`));continue;
      }
      if(/^SAYFA \d+$/.test(command)){
        if(transport.guarded){process.stdout.write('Önce DEVAM yazıp mevcut kontrolü bitir.\n');continue;}
        const chosen=context.pages()[Number(command.split(' ')[1])-1];
        if(chosen){page=chosen;page.setDefaultTimeout(10_000);await page.bringToFront();}continue;
      }
      if(command.startsWith('IZIN ')){
        const origin=command.slice(5);
        if(recognisedAssistOrigin(origin)){allowed.add(new URL(origin).origin);process.stdout.write('Bu adreste sonraki DOLDUR komutu iletişim bilgilerini paylaşabilir: '+new URL(origin).origin+'\n');}
        else process.stdout.write('Bu adres için otomatik doldurma desteklenmiyor.\n');continue;
      }
      if(command!=='DOLDUR'){process.stdout.write('DOLDUR, DEVAM, DEVRET, SAYFALAR veya KAPAT kullan.\n');continue;}
      if(page.isClosed()){process.stdout.write('Seçili sekme kapalı. SAYFALAR ile başka sekme seç.\n');continue;}
      const origin=new URL(page.url()).origin;
      if(!allowed.has(origin)){
        process.stdout.write('Yeni adreste otomatik doldurma için ayrıca izin gerekiyor: '+origin+'\n');
        if(recognisedAssistOrigin(origin))process.stdout.write('İletişim bilgilerinin bu siteye yazılmasını istiyorsan IZIN '+origin+' yaz; ardından DOLDUR kullan.\n');continue;
      }
      if(transport.guarded){process.stdout.write('Önce mevcut sonucu incele ve DEVAM yaz.\n');continue;}
      try{
        await transport.protect(page);
        const result=await fillKnownApplicationFields(page,{profile,answers,origin,contactApproved:true});
        const event={at:new Date().toISOString(),origin,...result,blockedRequests:transport.blockedRequests};
        events.push(event);await save();
        process.stdout.write(`${result.filled} alan dolduruldu; ${result.alreadyCorrect} alan zaten doğru.\n`);
        const reasons:Record<string,string>={human_decision_required:'kararı/onayı sen vereceksin',manual_answer_required:'cevabı sen doldurmalısın',ambiguous_field:'birden fazla alan eşleşti; değiştirilmedi',interactive_widget_requires_human:'listeden kendin seçim yapmalısın',option_not_unique:'uygun seçenek kesinleşmedi',existing_value_preserved:'mevcut cevabın korundu',site_validation_requires_human:'site bu değeri kabul etmedi; kontrol et',manual_file_selection_required:'dosyayı kendin seçmelisin',no_matching_fields:'önce başvuru formunu açmalısın'};
        for(const field of result.remaining.slice(0,20))process.stdout.write('- '+(field.label || 'İsimsiz alan').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,200)+': '+(reasons[field.reason] ?? 'kendin kontrol et')+'\n');
        if(transport.blockedRequests)process.stdout.write('Doldurma sırasında sitenin ağ istekleri engellendi; bu işlem sunucuya kaydedilmiş sayılmaz.\n');
        process.stdout.write(result.status==='login_required'?'Giriş alanı açık; DEVAM yazıp girişi kendin tamamla.\n':'Bilinen alanlar kontrol edildi. CV ve kalan soruları kendin tamamlamak veya ilerlemek için DEVAM; tamamen devralmak için DEVRET yaz.\n');
      }catch(error){
        const code=error instanceof Error && /^ASSIST_[A-Z_]+$/.test(error.message)?error.message:'ASSIST_FILL_FAILED';
        events.push({at:new Date().toISOString(),origin,code,blockedRequests:transport.blockedRequests});await save();
        process.stdout.write('Formun son durumu doğrulanamadığı için doldurma durdu. Otomatik tekrar yapılmadı. Formu kontrol et; elle devam için DEVAM veya çıkmak için KAPAT yaz.\n');
      }
    }
  }finally{lines.close();await browser.close();}
}
void main().catch(error=>{
  const code=error instanceof Error && /^(ASSIST|JOB|PREP)_[A-Z_]+$/.test(error.message)?error.message:'ASSIST_FAILED';
  const messages:Record<string,string>={ASSIST_CONTACT_CONSENT_REQUIRED:'İletişim bilgilerini seçtiğin siteye yazmak için --approve-contact-sharing onayı gerekir.',ASSIST_INTERACTIVE_TERMINAL_REQUIRED:'Bu yardımcıyı VS Code gibi normal bir terminalde çalıştır; açık tarayıcıyı kendin kontrol etmen gerekiyor.',ASSIST_ARGUMENTS_INVALID:'Bir ilan bağlantısı ver. Kullanım için npm run assist -- --help çalıştır.',JOB_PLATFORM_UNSUPPORTED:'Bu bağlantı biçimi desteklenmiyor. Doğrudan bir LinkedIn, Indeed, Kariyer.net, Lever veya Greenhouse ilanı kullan.',PREP_INPUT_INVALID:'Yerel profil/cevap dosyası okunamadı. Dosya yolunu kontrol et.'};
  console.error(messages[code] ?? 'Yardımcı başlatılamadı. Profil/cevap dosyalarını ve bağlantıyı kontrol et; kullanım için npm run assist -- --help çalıştır.');process.exitCode=1;
});

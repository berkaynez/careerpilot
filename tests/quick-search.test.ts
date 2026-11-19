import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startHub} from '../src/hub/server.js';
import {demoProfile} from '../src/hub/demo.js';
import {chromium} from 'playwright';
import {defaults,filterJobs} from '../src/quick/search.js';
import type {FreehireRow} from '../src/discovery/freehire.js';

const row: FreehireRow={title:'Junior Data Analyst',public_slug:'fictional-analyst',countries:['TR'],location:'Istanbul',work_mode:'hybrid'};
test('quick preferences apply role, city, work mode, experience and remote country',()=>{
  const candidates=[row,{...row,public_slug:'ankara',location:'Ankara'},
    {...row,public_slug:'remote',location:'Ankara',work_mode:'remote'},
    {...row,public_slug:'foreign',countries:['US'],work_mode:'remote'},
    {...row,public_slug:'senior',title:'Senior Data Analyst'},
    {...row,public_slug:'sales',title:'Sales Representative'}];
  assert.deepEqual(filterJobs(candidates,defaults).map(job=>job.title),[row.title,row.title]);
  assert.deepEqual(filterJobs(candidates,{...defaults,remote:false}).map(job=>job.url),['https://freehire.me/jobs/fictional-analyst']);
  assert.equal(filterJobs(candidates,{...defaults,roles:['support']}).length,0);
  assert.deepEqual(filterJobs([{...row,title:'Junior Muhasebe İş Analisti'}, {...row,title:'Junior Financial Analyst & Accountant'}],{...defaults,roles:['finance','business']}),[]);
  const unclear={...row,title:'Data Analyst'};
  assert.equal(filterJobs([unclear],defaults).length,0);
  assert.equal(filterJobs([unclear],{...defaults,includeUnclear:true}).length,1);
  assert.equal(filterJobs([{...row,title:'Junior Financial Analyst'}],{...defaults,roles:['finance']}).length,1);
});

test('quick screen restores choices and searches fictional transport only',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'careerpilot-unified-'));
  const pdf=join(dir,'fictional-finance.pdf');
  await writeFile(pdf,'%PDF-1.7\nFictional finance bytes');
  const profile={...demoProfile,cvs:[...demoProfile.cvs,...demoProfile.cvs.map(cv=>({...cv,id:'finance-'+cv.id,focus:'finance' as const,path:pdf}))]};
  const finance={...row,title:'Junior Financial Analyst',company:'Kurgusal Şirket',public_slug:'finance',description:'Kurgusal finans ilanında raporlama görevi.'};
  const hub=await startHub({directory:join(dir,'jobs'),profile,
    freehireSearch:async()=>({rows:[row,finance],total:2,examined:2,rejected:0,cached:false}),
    discoveryReader:async()=>({jobs:[],rejected:0})});
  const origin=hub.origin;
  t.after(async()=>{await hub.close();await rm(dir,{recursive:true,force:true});});
  const browser=await chromium.launch();t.after(()=>browser.close());
  const page=await browser.newPage();await page.goto(origin+'/quick');
  await page.getByLabel('IT uzmanı').uncheck();
  await page.reload();await page.locator('#go:enabled').waitFor();
  assert.equal(await page.getByLabel('IT uzmanı').isChecked(),false);
  await page.getByRole('button',{name:'Ücretsiz ilan ara'}).click();
  await page.getByRole('link',{name:'Junior Data Analyst'}).waitFor();
  assert.equal(await page.locator('#summary').innerText(),'2 kayıt incelendi · 1 sonuç');
  await page.goto(origin+'/quick?tara=1');
  await page.getByRole('link',{name:'Junior Data Analyst'}).waitFor();
  assert.equal(await page.getByLabel('IT uzmanı').isChecked(),false);
  assert.match(await page.locator('#report').innerText(),/Dream Games \(Lever\)/);
  assert.match(await page.locator('#report').innerText(),/Good Job Games \(Greenhouse\)/);
  await page.getByText('Diğer roller',{exact:true}).click();
  await page.getByLabel('Finansal analist').check();
  await page.locator('#go').click();
  await page.getByRole('link',{name:finance.title}).locator('..').getByRole('button').click();
  await page.locator('#new-form [name=language]').selectOption('tr');
  assert.equal(await page.locator('#new-form [name=documentFocus]').inputValue(),'finance');
  await page.getByRole('button',{name:'İlanı kaydet'}).click();
  const draft=page.locator('#draft-dialog');
  const file=page.waitForEvent('download');
  await draft.getByRole('button',{name:'Kayıtlı finans CV’sini indir (PDF)'}).click();
  const original=await file;assert.equal(original.suggestedFilename(),'fictional-finance.pdf');
  assert.equal(await readFile((await original.path())!,'utf8'),await readFile(pdf,'utf8'));
  await draft.locator('input[value=degree]').check();
  await draft.getByRole('button',{name:'CV ve ön yazı oluştur'}).click();
  for(const label of ['CV taslağı','Ön yazı']){
    const pending=page.waitForEvent('download');
    await draft.getByRole('button',{name:label+' indir (PDF)'}).click();
    const download=await pending;
    assert.ok(download.suggestedFilename().endsWith('.pdf'));
    const bytes=await readFile((await download.path())!);
    assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.ok(bytes.length>5000);
  }
  await draft.getByRole('button',{name:'Kapat'}).click();
  await page.locator('#quick-open').click();
  assert.equal(await page.getByRole('link',{name:finance.title}).count(),1);
  assert.equal(page.context().pages().length,1);
});

test('public boards retain independent successes and cache scans; foreign remote stays outside TR',async()=>{
  const {employerFeeds}=await import('../src/quick/boards.js');
  let calls=0;
  const read=employerFeeds(async source=>{
    calls++;
    if(source.board!=='dreamgames')throw Error('offline');
    const job={externalId:'x',title:'Junior Software Engineer',text:'A fictional vacancy.',
      url:'https://example.test/opening',location:'Remote',remote:true,workMode:'remote',country:'TR'};
    return {jobs:[job,{...job,externalId:'y',country:'US'}],rejected:0};
  });
  const [a,b]=await Promise.all([read(),read()]);
  assert.equal(calls,a.length);
  assert.deepEqual(a,b);
  assert.equal(a.filter(source=>source.ok).length,1);
  const results=filterJobs(a.flatMap(source=>source.rows),defaults);
  assert.equal(results.length,1);
  assert.equal(results[0]?.url,'https://example.test/opening');
});

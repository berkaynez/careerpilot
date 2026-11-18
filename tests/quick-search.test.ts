import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {defaults,filterJobs} from '../src/quick/search.js';
import {quickRoutes} from '../src/quick/routes.js';
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
});

test('quick screen restores choices and searches fictional transport only',async t=>{
  const handle=quickRoutes(async()=>({rows:[row],total:1,examined:1,rejected:0,cached:false}));
  let origin='';
  const server=createServer(async(req,res)=>{if(!await handle(req,res,origin))res.writeHead(404).end();});
  await new Promise<void>((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const address=server.address();assert.ok(address && typeof address==='object');origin='http://127.0.0.1:'+address.port;
  const browser=await chromium.launch();t.after(()=>browser.close());
  const page=await browser.newPage();await page.goto(origin+'/quick');
  await page.getByLabel('IT uzmanı').uncheck();
  await page.reload();await page.locator('#go:enabled').waitFor();
  assert.equal(await page.getByLabel('IT uzmanı').isChecked(),false);
  await page.getByRole('button',{name:'Ücretsiz ilan ara'}).click();
  await page.getByRole('link',{name:'Junior Data Analyst'}).waitFor();
  assert.equal(await page.locator('#summary').innerText(),'1 kayıt incelendi · 1 sonuç');
});

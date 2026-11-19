import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createFreehireSearch } from '../discovery/freehire.js';
import { defaults, filterJobs, preferences, roleNames } from './search.js';

import { employers, employerFeeds } from './boards.js';
import { jobLink } from '../jobs/links.js';

const sources = [...employers.map(({company,provider})=>({name:company,provider:provider==='lever'?'Lever':'Greenhouse'})),
  {name:'FreeHire',provider:'Türkiye ilan akışı'}];
export function quickRoutes(search = createFreehireSearch(), boards = employerFeeds()) {
  return async (req: IncomingMessage, res: ServerResponse, origin: string) => {
    const path = new URL(req.url ?? '/',origin).pathname;
    if (!['/quick.js','/quick-config','/quick-search'].includes(path)) return false;
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    if (req.headers.host !== new URL(origin).host || req.headers['sec-fetch-site']==='cross-site') {
      res.writeHead(403).end(); return true;
    }
    if (path==='/quick.js' && req.method==='GET') {
      const data=await readFile(new URL('./public/quick.js',import.meta.url));
      res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'}).end(data);return true;
    }
    res.setHeader('Content-Type','application/json');
    if (path==='/quick-config' && req.method==='GET') {
      res.end(JSON.stringify({defaults,roleNames,sources})); return true;
    }
    if (path!=='/quick-search' || req.method!=='POST') {res.writeHead(405).end(); return true;}
    if (req.headers.origin!==origin || req.headers['content-type']!=='application/json') {res.writeHead(403).end();return true;}
    const parts: Buffer[] = [];
    let bytes = 0;
    for await (const part of req) {
      bytes += part.length;
      if (bytes>4096) {res.writeHead(413).end();return true;}
      parts.push(part);
    }
    let prefs;
    try { prefs=preferences.parse(JSON.parse(Buffer.concat(parts).toString())); }
    catch {res.writeHead(400).end(JSON.stringify({error:'Rol, şehir ve çalışma biçimini kontrol et.'}));return true;}
    const page=Number(new URL(req.url??'/',origin).searchParams.get('page')??1);
    if (!Number.isInteger(page)||page<1||page>10) {res.writeHead(400).end();return true;}
    const [boardResults,free]=await Promise.all([
      page===1?boards():Promise.resolve([]),
      search({scope:'turkey',earlyCareer:prefs.junior,page,includeUnlabelled:true,
        categories:[]},AbortSignal.timeout(25_000))
        .catch(()=>null),
    ]);
    const reports=boardResults.map(({source,examined,ok})=>({source,examined,ok}));
    reports.push({source:'FreeHire',examined:free?.examined??0,ok:Boolean(free)});
    const rows=boardResults.flatMap(result=>result.rows);
    for (const row of free?.rows??[]) {
      let employerUrl:string|undefined;
      try { if(row.url) employerUrl=jobLink(row.url).url; } catch { /* Keep the aggregator link. */ }
      rows.push({...row,...(employerUrl?{employerUrl}:{})});
    }
    const jobs=filterJobs(rows,prefs);
    const details=reports.map(item=>({...item,provider:sources.find(source=>source.name===item.source)?.provider??item.source,
      matched:new Set(jobs.filter(job=>job.source===item.source).map(job=>job.url)).size}));
    const examined=reports.reduce((sum,item)=>sum+item.examined,0);
    const more=free && page<10 && page*30<free.total && free.examined===30;
    res.end(JSON.stringify({jobs,examined,reports:details,nextPage:more?page+1:null}));
    return true;
  };
}

import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createFreehireSearch } from '../discovery/freehire.js';
import { defaults, filterJobs, preferences, roleNames } from './search.js';

import { employerFeeds } from './boards.js';
import { jobLink } from '../jobs/links.js';

const files = new Map([['/quick','index.html'],['/quick.js','quick.js'],['/quick.css','quick.css']]);
export function quickRoutes(search = createFreehireSearch(), boards = employerFeeds(), panel?: string) {
  return async (req: IncomingMessage, res: ServerResponse, origin: string) => {
    const path = new URL(req.url ?? '/',origin).pathname;
    if (!files.has(path) && !['/quick-config','/quick-search'].includes(path)) return false;
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    if (req.headers.host !== new URL(origin).host || req.headers['sec-fetch-site']==='cross-site') {
      res.writeHead(403).end(); return true;
    }
    const file = files.get(path);
    if (file && req.method==='GET') {
      const type = file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html';
      const data = await readFile(new URL('./public/'+file,import.meta.url));
      res.writeHead(200,{'Content-Type':type+'; charset=utf-8'}).end(data); return true;
    }
    res.setHeader('Content-Type','application/json');
    if (path==='/quick-config' && req.method==='GET') {
      res.end(JSON.stringify({app:'careerpilot-quick-v4',defaults,roleNames,panel:panel??'/'})); return true;
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
    const examined=reports.reduce((sum,item)=>sum+item.examined,0);
    const more=free && page<10 && page*30<free.total && free.examined===30;
    res.end(JSON.stringify({jobs,examined,reports,nextPage:more?page+1:null}));
    return true;
  };
}

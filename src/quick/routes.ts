import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createFreehireSearch } from '../discovery/freehire.js';
import { discoveryCategories } from '../discovery/role-profiles.js';
import { defaults, filterJobs, preferences, roleNames } from './search.js';

const files = new Map([['/quick','index.html'],['/quick.js','quick.js'],['/quick.css','quick.css']]);
export function quickRoutes(search = createFreehireSearch()) {
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
      res.end(JSON.stringify({app:'careerpilot-quick-v1',defaults,roleNames})); return true;
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
    try {
      const result=await search({scope:'turkey',earlyCareer:prefs.junior,page:1,includeUnlabelled:true,
        categories:prefs.roles.includes('support') ? [] : discoveryCategories(prefs.roles.map(key=>roleNames[key]))},AbortSignal.timeout(25_000));
      res.end(JSON.stringify({jobs:filterJobs(result.rows,prefs),examined:result.examined,cached:result.cached}));
    } catch(error) {
      const wait=error instanceof Error && /COOLDOWN|RATE_LIMITED|BUSY/.test(error.message);
      res.writeHead(503).end(JSON.stringify({error:wait?'Kaynak bekleme süresi uyguluyor. Biraz sonra tekrar dene.':'FreeHire şu anda okunamadı. Daha sonra yeniden dene.'}));
    }
    return true;
  };
}

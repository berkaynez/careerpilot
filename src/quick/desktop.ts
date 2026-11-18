import { createServer } from 'node:http';
import { quickRoutes } from './routes.js';

const port=3214;
const origin='http://127.0.0.1:'+port;
const handle=quickRoutes(undefined,undefined,'http://127.0.0.1:3211/');
const server=createServer(async (req,res)=>{
  try {if (!await handle(req,res,origin)) res.writeHead(404).end();}
  catch {res.writeHead(500).end();}
});
server.listen(port,'127.0.0.1');

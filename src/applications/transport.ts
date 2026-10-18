import type { BrowserContext, Page } from 'playwright';
import { guardSubmission } from '../lever/review.js';

/** Manual browsing is normal site traffic. During each fill pass, all writes and API traffic stop. */
export async function assistTransport(context:BrowserContext) {
  let guarded=false, blocked=0;
  let releaseGuard:(()=>Promise<void>) | undefined;
  let protectedPage:Page | undefined;
  const sockets=new Set<()=>void>();
  await context.routeWebSocket('**/*',socket=>{
    if(guarded){socket.close();return;}
    const close=()=>socket.close();sockets.add(close);socket.connectToServer();
    socket.onClose(()=>sockets.delete(close));
  });
  await context.route('**/*',async route=>{
    if(!guarded){await route.fallback();return;}
    blocked++;await route.abort();
  });
  return {
    get guarded(){return guarded;},
    get blockedRequests(){return blocked;},
    async protect(page:Page){
      if(guarded)throw new Error('ASSIST_ALREADY_GUARDED');
      guarded=true;blocked=0;
      for(const close of sockets)close();sockets.clear();
      protectedPage=page;releaseGuard=await guardSubmission(page,true);
    },
    async allowManual(){
      // Only a trusted terminal command may call this; never an event from page content.
      if(releaseGuard && !protectedPage?.isClosed())await releaseGuard();
      releaseGuard=undefined;protectedPage=undefined;guarded=false;
    },
  };
}

export function recognisedAssistOrigin(value:string):boolean {
  try {
    const url=new URL(value);
    if(url.protocol!=='https:' || url.port || url.username || url.password || url.search || url.hash || url.pathname!=='/')return false;
    return ['linkedin.com','indeed.com','kariyer.net'].some(domain=>url.hostname===domain || url.hostname.endsWith('.'+domain))
      || ['jobs.lever.co','boards.greenhouse.io','job-boards.greenhouse.io','job-boards.eu.greenhouse.io'].includes(url.hostname);
  }catch{return false;}
}

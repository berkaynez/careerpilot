import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { jobLink, employerLinks } from './links.js';
import type { JobLink } from './links.js';

export interface PublicJobPage {
  url: string; title: string; company: string; text: string; links: string[];
}
export type LinkResolution = { status: 'resolved'; input: JobLink; employer: JobLink; page: PublicJobPage; visited: string[] }
  | {status: 'employer_link_required'; input: JobLink; reason: 'public_page_unavailable' | 'no_employer_link' | 'ambiguous_employer_links'; candidates: JobLink[]; visited: string[]};

/** Read public posting content, excluding controls, hidden text and executable markup. */
export async function extractPublicJobPage(page: Page): Promise<PublicJobPage> {
  return page.evaluate(() => {
    const helpers = {
      clean(text: string | null) { return (text ?? '').replace(/\s+/g,' ').trim(); },
      visible(element: Element) { const style = getComputedStyle(element); return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && !element.closest('[hidden],[aria-hidden="true"]'); },
      text(root: Element) {
        const clone = root.cloneNode(true) as Element;
        const originals = root.querySelectorAll('*'), copies = clone.querySelectorAll('*');
        originals.forEach((element,index) => { if (!helpers.visible(element)) copies[index]?.remove(); });
        clone.querySelectorAll('script,style,input,textarea,select,button,[hidden],[aria-hidden="true"]').forEach(element=>element.remove());
        return helpers.clean(clone.textContent);
      },
    };
    let structured: Record<string,unknown> | undefined;
    const nodes: unknown[] = [];
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      if ((script.textContent?.length ?? 0) > 200_000) continue;
      try { nodes.push(JSON.parse(script.textContent ?? '')); } catch { /* Public metadata is optional. */ }
    }
    for (let index=0; index<nodes.length && index<100; index++) {
      const value = nodes[index];
      if (Array.isArray(value)) {nodes.push(...value.slice(0,100));continue;}
      if (!value || typeof value !== 'object') continue;
      const item=value as Record<string,unknown>;
      if (item['@type'] === 'JobPosting' || Array.isArray(item['@type']) && item['@type'].includes('JobPosting')) {structured=item;break;}
      if (Array.isArray(item['@graph'])) nodes.push(...item['@graph'].slice(0,100));
    }
    const heading = Array.from(document.querySelectorAll('h1,h2')).filter(helpers.visible)
      .map(element=>helpers.clean(element.textContent)).find(text=>text && !/^apply|submit your application$/i.test(text)) ?? '';
    const title = typeof structured?.title === 'string' ? helpers.clean(structured.title) : heading;
    const org=structured?.hiringOrganization;
    let company=org && typeof org === 'object' && 'name' in org && typeof org.name === 'string' ? helpers.clean(org.name) : '';
    if (!company && title && document.title.endsWith(' - '+title)) company=helpers.clean(document.title.slice(0,-title.length-3));
    if (!company && title && document.title.startsWith('Job Application for '+title+' at ')) company=helpers.clean(document.title.slice(('Job Application for '+title+' at ').length));
    let text='';
    if (typeof structured?.description === 'string') {
      const parsed=new DOMParser().parseFromString(structured.description,'text/html');
      parsed.body.querySelectorAll('script,style,input,textarea,select,button,[hidden],[aria-hidden="true"]').forEach(element=>element.remove());
      text=helpers.clean(parsed.body.textContent);
    }
    if (!text) text=helpers.text(document.querySelector('main,.posting-page,.content') ?? document.body);
    const links=Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
      .filter(element=>helpers.visible(element) && /apply|başvur/i.test(element.textContent ?? ''))
      .map(element=>element.href).slice(0,100);
    return {url:location.href,title:title.slice(0,1200),company:company.slice(0,1200),text:text.slice(0,24000),links};
  });
}

export function browserJobReader(launch: () => Promise<Browser> = () => chromium.launch({headless:true})) {
  return async (link: JobLink): Promise<PublicJobPage> => {
    const browser=await launch();
    try {
      const context=await browser.newContext({javaScriptEnabled:false,serviceWorkers:'block',acceptDownloads:false});
      await context.routeWebSocket('**/*',socket=>socket.close());
      await context.route('**/*',route=> {
        const request=route.request();
        return request.method()==='GET' && request.resourceType()==='document' && request.url()===link.url
          ? route.fallback() : route.abort();
      });
      const page=await context.newPage();
      const response=await page.goto(link.url,{waitUntil:'domcontentloaded',timeout:25_000});
      if (!response?.ok() || page.url()!==link.url) throw new Error('JOB_PUBLIC_PAGE_UNAVAILABLE');
      return await extractPublicJobPage(page);
    } finally { await browser.close(); }
  };
}

/** At most one observed LinkedIn -> employer transition, never login, guessing or unlimited crawling. */
export async function resolveJobLink(value: string, read = browserJobReader()): Promise<LinkResolution> {
  const input=jobLink(value), visited=[input.url];
  let page: PublicJobPage;
  try { page=await read(input); }
  catch { return {status:'employer_link_required',input,reason:'public_page_unavailable',candidates:[],visited}; }
  if (input.platform!=='linkedin') return {status:'resolved',input,employer:input,page,visited};
  const candidates=employerLinks(page.links);
  if (candidates.length!==1) return {status:'employer_link_required',input,reason:candidates.length?'ambiguous_employer_links':'no_employer_link',candidates,visited};
  const employer=candidates[0]!; visited.push(employer.url);
  try { page=await read(employer); }
  catch { return {status:'employer_link_required',input,reason:'public_page_unavailable',candidates,visited}; }
  return {status:'resolved',input,employer,page,visited};
}

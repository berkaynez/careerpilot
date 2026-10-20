export type JobPlatform = 'linkedin' | 'lever' | 'greenhouse' | 'indeed' | 'kariyer' | 'freehire';
export interface JobLink { platform: JobPlatform; url: string }

/** Normalise known posting URLs, never navigate arbitrary redirect targets or private hosts. */
export function jobLink(value: string): JobLink {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('JOB_LINK_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) throw new Error('JOB_LINK_INVALID');
  let platform: JobPlatform;
  let jobKey: string | null = null;
  if ((url.hostname === 'linkedin.com' || /^(?:www|[a-z]{2})\.linkedin\.com$/.test(url.hostname)) && /^\/jobs\/view\/(?:[^/]*-)?\d+\/?$/.test(url.pathname)) {
    platform = 'linkedin'; url.hostname = 'www.linkedin.com'; url.pathname = '/jobs/view/' + /(?:^|[-/])(\d+)\/?$/.exec(url.pathname)![1];
  } else if (url.hostname === 'jobs.lever.co' && /^\/[a-zA-Z0-9_-]+\/[a-f0-9-]{36}(?:\/apply)?\/?$/.test(url.pathname)) {
    platform = 'lever'; url.pathname = url.pathname.replace(/\/$/, '').replace(/\/apply$/, '');
  } else if (['boards.greenhouse.io','job-boards.greenhouse.io','job-boards.eu.greenhouse.io'].includes(url.hostname)
    && /^\/[a-zA-Z0-9_-]+\/jobs\/\d+\/?$/.test(url.pathname)) platform = 'greenhouse';
  else if ((url.hostname === 'indeed.com' || /^(?:www|[a-z]{2})\.indeed\.com$/.test(url.hostname))
    && ['/viewjob','/m/viewjob'].includes(url.pathname) && /^[a-f0-9]{16}$/.test(url.searchParams.get('jk') ?? '')
    && url.searchParams.getAll('jk').length === 1) { platform='indeed'; jobKey=url.searchParams.get('jk'); }
  else if (['www.kariyer.net','kariyer.net'].includes(url.hostname) && /^\/is-ilani\/[a-zA-Z0-9%_-]+-\d+$/.test(url.pathname)) platform='kariyer';
  else if (url.hostname === 'freehire.me' && /^\/jobs\/[a-z0-9][a-z0-9-]{0,199}$/.test(url.pathname)) platform='freehire';
  else throw new Error('JOB_PLATFORM_UNSUPPORTED');
  // Keep tracking and applicant information out of requests and recorded source URLs.
  url.search = ''; if (jobKey) url.searchParams.set('jk',jobKey); url.pathname = url.pathname.replace(/\/$/, '');
  return {platform,url:url.href};
}

export function employerLinks(links: string[]): JobLink[] {
  const found = new Map<string,JobLink>();
  for (const value of links) {
    try {
      let url = new URL(value);
      if (url.protocol === 'https:' && ['www.linkedin.com','linkedin.com'].includes(url.hostname)
        && /^\/jobs\/view\/externalApply\//.test(url.pathname)) {
        const target = url.searchParams.get('url'); if (!target) continue;
        url = new URL(target);
      }
      const link = jobLink(url.href);
      if (link.platform === 'lever' || link.platform === 'greenhouse') found.set(link.url,link);
    } catch { /* Unsupported destinations are data, never a reason to browse off-platform. */ }
  }
  return [...found.values()];
}

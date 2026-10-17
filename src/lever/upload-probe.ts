import { chromium } from 'playwright';
import { leverUrls } from './form.js';

export const uploadScripts = new Set(['/js/jquery-3.6.1.min.js', '/js/select2.full.min.js', '/js/parseResume.js',
  '/js/application.js', '/js/debounce.min.js', '/js/retrieveLocations.js']);
export function canBootstrapUpload(url: string, method: string, kind: string, source: string) {
  const urls = leverUrls(source), target = new URL(url);
  if (method !== 'GET' || target.origin !== 'https://jobs.lever.co') return false;
  if (kind === 'document') return target.href === urls.apply;
  if (kind === 'script') return !target.search && uploadScripts.has(target.pathname);
  return ['stylesheet','image','font'].includes(kind);
}

/** Probe uses only fictional bytes. Every non-GET request is aborted; never use real CV bytes here. */
export async function probeLeverUpload(source: string) {
  const urls = leverUrls(source);
  const browser = await chromium.launch({ headless: true });
  const requests: { url: string; method: string; contentType: string; fields: string[] }[] = [];
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.route('**/*', async route => {
      const request = route.request();
      if (request.method() !== 'GET') {
        const contentType = request.headers()['content-type'] ?? '';
        let fields: string[] = [];
        const body = request.postDataBuffer();
        if (body && body.length < 100_000 && contentType.startsWith('multipart/form-data')) {
          try { fields = [...(await new Response(new Uint8Array(body), { headers: { 'Content-Type': contentType } }).formData()).keys()]; } catch { /* No payloads or error bodies are retained. */ }
        }
        requests.push({ url: request.url(), method: request.method(), contentType: contentType.split(';')[0]!, fields });
        await route.abort(); return;
      }
      if (canBootstrapUpload(request.url(), request.method(), request.resourceType(), source)) await route.continue();
      else await route.abort();
    });
    const page = await context.newPage(); page.setDefaultTimeout(15_000);
    await page.goto(urls.apply, { waitUntil: 'load', timeout: 30_000 });
    const input = page.locator('input[type="file"][name="resume"]');
    if (await input.count() !== 1) throw new Error('LEVER_UPLOAD_CONTROL_UNRECOGNISED');
    await input.setInputFiles({ name: 'fictional-upload-probe.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nFictional offline probe; no candidate data.\n%%EOF') });
    // Wait for either the attempted request or a bounded deadline, never retry.
    const until = Date.now()+8_000;
    while (!requests.length && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 100));
    return { status: requests.length ? 'upload_request_observed_but_blocked' : 'no_upload_request_observed',
      attemptedRequests: requests, dataSent: false, cvUploaded: false, submitted: false, modelCalls: 0 };
  } finally { await browser.close(); }
}

import { chromium } from 'playwright';
import { leverUrls, canInspectLeverRequest, inspectLeverForm } from './form.js';

/** One isolated public posting, without site scripts, workers, sessions or write requests. */
export async function openLeverSession(source: string) {
  const urls = leverUrls(source);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block', acceptDownloads: false });
    await context.route('**/*', route => {
      const request = route.request();
      return canInspectLeverRequest(request.url(), request.method(), request.resourceType(), source) ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000); page.setDefaultNavigationTimeout(30_000);
    await page.goto(urls.description, { waitUntil: 'domcontentloaded' });
    if (page.url() !== urls.description) throw new Error('LEVER_UNEXPECTED_PAGE');
    const links = await page.locator('a[href]').evaluateAll(elements => elements.map(el => ({
      text: el.textContent?.trim() ?? '', href: (el as HTMLAnchorElement).href,
    })));
    const applyLinks = links.filter(link => /apply/i.test(link.text) && link.href === urls.apply);
    if (!applyLinks.length) throw new Error('LEVER_APPLY_LINK_MISSING');
    await page.goto(applyLinks[0]!.href, { waitUntil: 'domcontentloaded' });
    const form = await inspectLeverForm(page, urls.apply);
    if (!form.fields.some(field => field.name === 'name') || !form.fields.some(field => field.name === 'email')) throw new Error('LEVER_FORM_UNRECOGNISED');
    return { browser, page, form };
  } catch (error) { await browser.close(); throw error; }
}

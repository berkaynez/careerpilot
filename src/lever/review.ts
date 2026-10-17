import type { Page } from 'playwright';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

export interface LeverReviewSession {
  page: Page;
  directory: string;
  /** Called only after the human types DEVRET; never clicks or submits anything. */
  releaseToUser(): Promise<void>;
}

/** Guard only the current prepared document; future manual navigation is not instrumented. */
export async function guardSubmission(page: Page) {
  const controller = await page.evaluateHandle(() => {
    const controller = new AbortController();
    window.addEventListener('submit', event => { event.preventDefault(); event.stopImmediatePropagation(); }, {capture:true,signal:controller.signal});
    window.addEventListener('click', event => {
      if (event.target instanceof Element && event.target.closest('button[type="submit"],input[type="submit"],#btn-submit,#hcaptchaSubmitBtn,input[type="checkbox"],input[type="radio"]')) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, {capture:true,signal:controller.signal});
    return controller;
  });
  return async () => { await controller.evaluate(controller => controller.abort()); await controller.dispose(); };
}

/** EOF, closing the page, and every answer except the literal command leave protections in place. */
export async function reviewDecision(page: Page, input: Readable, output: Writable): Promise<'release' | 'close'> {
  if (page.isClosed()) return 'close';
  const lines = createInterface({input,output,terminal:false});
  return new Promise(resolve => {
    const finish = (answer: 'release' | 'close') => {
      page.off('close', closed);
      lines.removeAllListeners('line'); lines.removeAllListeners('close'); lines.close();
      resolve(answer);
    };
    const closed = () => finish('close');
    page.once('close',closed);
    lines.on('close',closed);
    lines.on('line',line => {
      if (line.trim() === 'DEVRET') finish('release');
      else if (line.trim() === 'KAPAT') finish('close');
      else output.write('Kontrolü almak için DEVRET, göndermeden çıkmak için KAPAT yaz.\n');
    });
    output.write('Form hazır. DEVRET: normal site bağlantılarını açar ve kontrolü sana bırakır. KVKK, CAPTCHA ve gönderme sana aittir. KAPAT: göndermeden çıkar.\n');
  });
}

export async function terminalReview(session: LeverReviewSession) {
  process.stdout.write(`Kontrol görüntüsü: ${session.directory}\n`);
  if (await reviewDecision(session.page, process.stdin, process.stdout) !== 'release') return;
  await session.releaseToUser();
  process.stdout.write('Kontrol sende. Bilgileri inceleyip gerekirse düzelt; KVKK, CAPTCHA ve gönderme adımlarını kendin tamamla. İşin bitince bu tarayıcı penceresini kapat. Program başvuru sonucunu takip etmiyor.\n');
  if (!session.page.isClosed()) await session.page.waitForEvent('close',{timeout:0});
}

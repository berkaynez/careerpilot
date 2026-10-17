import type { Page } from 'playwright';
import type { BrowserObservation } from '../contracts.js';

/** IDs are generated locally, never copied from page-provided IDs or field values. */
export async function inspectPage(page: Page, observationId: string, assignIds = true): Promise<BrowserObservation> {
  return page.evaluate(({ observationId, assignIds }) => {
    // Object methods remain self-contained when tsx/esbuild serializes this
    // function for Chromium (named arrow helpers can acquire a Node-only __name).
    const helpers = {
      visible(element: Element): boolean {
        const style = getComputedStyle(element);
        for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
          const ancestorStyle = getComputedStyle(ancestor);
          if (ancestorStyle.opacity === '0' || ancestorStyle.visibility === 'collapse') return false;
        }
        return element.getClientRects().length > 0 && style.visibility !== 'hidden' && style.display !== 'none'
          && !element.closest('[hidden],[inert],[aria-hidden="true"]');
      },
      text(element: Element | null): string {
        if (!element) return '';
        const clone = element.cloneNode(true) as Element;
        // A wrapping label contains its select's options; they are not its name.
        clone.querySelectorAll('input,textarea,select').forEach(control => control.remove());
        return clone.textContent?.trim().replace(/\s+/g, ' ') ?? '';
      },
      described(element: Element, attribute: string): string {
        return (element.getAttribute(attribute) ?? '').split(/\s+/).filter(Boolean)
          .map(id => helpers.text(document.getElementById(id))).join(' ');
      },
    };
    const elements = [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement | HTMLAnchorElement>(
      'input,select,textarea,button,a[href]',
    )].filter(element => helpers.visible(element) && !element.matches(':disabled')
      && !(element instanceof HTMLInputElement && ['hidden', 'file', 'password', 'reset', 'image'].includes(element.type)));
    const controls = elements.map((element, index) => {
      const id = `${observationId}-control-${index}`;
      if (assignIds) element.setAttribute('data-careerpilot-id', id);
      const actualId = element.getAttribute('data-careerpilot-id') ?? `unobserved-${index}`;
      const isInput = element instanceof HTMLInputElement;
      const kind = element instanceof HTMLSelectElement ? 'select' as const
        : element instanceof HTMLTextAreaElement ? 'textarea' as const
        : element instanceof HTMLButtonElement || element instanceof HTMLAnchorElement || (isInput && element.type === 'submit') ? 'button' as const
        : isInput && element.type === 'checkbox' ? 'checkbox' as const
        : isInput && element.type === 'radio' ? 'radio' as const : 'text' as const;
      let buttonEffect: 'navigation' | 'submission' | 'unknown' = 'unknown';
      if (kind === 'button') {
        if (element instanceof HTMLAnchorElement) {
          const target = new URL(element.href);
          if (target.origin === location.origin && ['http:'].includes(target.protocol) && !target.username && !target.password) buttonEffect = 'navigation';
        } else if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) {
          if (element.type === 'button') buttonEffect = 'navigation';
          else if (element.type === 'submit' && element.form) {
            const target = new URL(element.getAttribute('formaction') ?? element.form.action, location.href);
            const method = element.getAttribute('formmethod') ?? element.form.method;
            if (target.origin === location.origin && !target.username && !target.password && method.toLowerCase() === 'post') buttonEffect = 'submission';
          }
        }
      }
      const labels = 'labels' in element ? [...element.labels ?? []].map(helpers.text).join(' ') : '';
      const label = element.getAttribute('aria-label') || helpers.described(element, 'aria-labelledby') || labels
        || (kind === 'button' ? (isInput ? element.value : helpers.text(element)) : element.getAttribute('placeholder')) || '';
      return {
        id: actualId, kind, label: label.trim(),
        help: [helpers.text(element.closest('fieldset')?.querySelector('legend') ?? null), helpers.described(element, 'aria-describedby')].filter(Boolean).join(' · '),
        required: ('required' in element && element.required) || element.getAttribute('aria-required') === 'true',
        ...(isInput ? { inputType: element.type } : {}),
        ...(element.hasAttribute('data-consent-id') ? { consentId: element.getAttribute('data-consent-id')! } : {}),
        ...(kind === 'button' ? { buttonEffect } : {}),
        options: element instanceof HTMLSelectElement ? [...element.options].map((option, optionIndex) => ({
          id: `${actualId}-option-${optionIndex}`, label: option.label,
        })).filter((_, optionIndex) => !element.options[optionIndex]?.disabled) : [],
      };
    });
    const errors = [...document.querySelectorAll('[role="alert"],[aria-live="assertive"],[aria-invalid="true"]')]
      .filter(helpers.visible).map(element => element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement
        ? element.validationMessage : helpers.text(element)).filter(Boolean);
    const clone = document.body.cloneNode(true) as HTMLElement;
    const originalElements = document.body.querySelectorAll('*');
    const copiedElements = clone.querySelectorAll('*');

    originalElements.forEach((element, index) => {
      const style = getComputedStyle(element);

      if (style.display === 'none' || style.visibility === 'hidden'
        || style.visibility === 'collapse' || style.opacity === '0') {
        copiedElements[index]?.remove();
      }
    });
    clone.querySelectorAll('input,textarea,select,script,style,[hidden],[aria-hidden="true"]')
    .forEach(element => element.remove());
    return { id: observationId, origin: location.origin, title: document.title,
      text: (clone.textContent ?? '').trim().replace(/\s+/g, ' '), controls, errors };
  }, { observationId, assignIds });
}

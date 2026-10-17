import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { inspectPage } from '../src/browser/inspector.js';

test('inspector keeps visible text and excludes hidden text', async () => {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();

    await page.setContent(`
      <style>
        .concealed { display: none; }
      </style>
      <p>VISIBLE_TEXT</p>
      <div class="concealed"><span>CSS_HIDDEN</span></div>
      <p style="visibility: hidden;">VISIBILITY_HIDDEN</p>
      <p style="visibility: collapse;">COLLAPSE_HIDDEN</p>
      <p aria-hidden="true">ARIA_HIDDEN</p>
      <p hidden>HTML_HIDDEN</p>
    `);

    const observation = await inspectPage(page, 'test-observation');

    assert.match(observation.text, /VISIBLE_TEXT/);
    assert.doesNotMatch(observation.text, /CSS_HIDDEN|VISIBILITY_HIDDEN|COLLAPSE_HIDDEN|ARIA_HIDDEN|HTML_HIDDEN/);
  } finally {
    await browser.close();
  }
});
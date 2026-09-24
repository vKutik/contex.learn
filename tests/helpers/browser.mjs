/* browser.mjs - drive the real app in real Chromium.
 *
 * CLAUDE.md is explicit that this app is tested in a browser and not by
 * reasoning, so the end-to-end tests are the ones that matter most. Two
 * safety properties hold for every one of them:
 *
 *   - the page runs in a throwaway context, so its localStorage is created
 *     and destroyed with the test and no real progress is ever read or written;
 *   - the app is served from the working tree unmodified. Nothing is stubbed,
 *     patched or injected except the starting progress, which is written into
 *     the empty context before the app boots.
 *
 * Playwright is a developer tool, not a dependency of the app: it is looked
 * for in a few places and, when it is not installed, the browser suites skip
 * with a reason instead of failing the run.
 */
import { createRequire } from 'node:module';
import { startServer } from './server.mjs';

const require = createRequire(import.meta.url);

const CANDIDATES = [
  'playwright',
  'playwright-core',
  '/opt/node22/lib/node_modules/playwright',
  '/usr/lib/node_modules/playwright',
  '/usr/local/lib/node_modules/playwright'
];

function loadPlaywright(){
  for(const id of CANDIDATES){
    try { return require(id); } catch(e){}
  }
  return null;
}

const playwright = loadPlaywright();

/** A reason string when the browser suites cannot run, or null when they can. */
export const browserSkip = playwright
  ? null
  : 'Playwright is not installed - run `npm i -g playwright` to include the browser suites';

/**
 * One browser and one server for a whole test file.
 * @returns {{page:Function, close:Function, origin:string}}
 */
export async function openApp(){
  const server = await startServer();
  const browser = await playwright.chromium.launch({
    // the pre-installed browser in this environment; Playwright's own
    // download is used when this path is not there
    executablePath: process.env.CHROMIUM_PATH || undefined
  });

  /**
   * A fresh page with a fresh, empty storage.
   * @param {object|null} progress  value for localStorage['vocab-progress']
   * @param {object} opts           { settings, events, path }
   */
  async function page(progress = null, opts = {}){
    const context = await browser.newContext({
      reducedMotion: 'reduce',        // the tests assert content, not animation
      viewport: { width: 420, height: 900 }
    });
    const pg = await context.newPage();

    // Two channels, kept apart on purpose. `errors` is code that threw and
    // nothing caught - always a bug. `logged` is anything the console marked
    // as an error, which includes failures the browser itself reports, such
    // as a request a test deliberately aborted.
    pg.errors = [];
    pg.logged = [];
    pg.on('pageerror', e => pg.errors.push(String(e)));
    pg.on('console', m => { if(m.type() === 'error') pg.logged.push(m.text()); });

    if(progress) await pg.addInitScript(
      v => localStorage.setItem('vocab-progress', v), JSON.stringify(progress));
    if(opts.events) await pg.addInitScript(
      v => localStorage.setItem('vocab-events', v), JSON.stringify(opts.events));
    if(opts.settings) await pg.addInitScript(
      v => localStorage.setItem('vocab-settings', v), JSON.stringify(opts.settings));

    await pg.goto(server.origin + (opts.path || '/'));
    await pg.waitForSelector('#screen > *', { state:'attached' });
    pg.close_ = () => context.close();
    return pg;
  }

  return {
    page,
    origin: server.origin,
    close: async () => { await browser.close(); await server.close(); }
  };
}

/* ---------- driving the quiz runner ---------- */

/** Every option button, whichever mechanic is on screen. */
export const OPTIONS = '.pill-opt, .sentence-opt, .opt';

/**
 * Answer the question on screen and wait for the runner to move on.
 *
 * The runner auto-advances (1.1s after a right answer, 2.8s after a wrong
 * one) and lets you tap to go sooner. The tap is used, because waiting out
 * the timer in five-question stages is what makes a browser suite slow enough
 * that people stop running it.
 *
 * @param {import('playwright').Page} page
 * @param {number} pick  index of the option to press
 */
export async function answer(page, pick = 0){
  await page.waitForSelector(OPTIONS);
  const before = await page.evaluate(() => document.querySelector('.qcard')?.innerHTML || '');

  const buttons = await page.$$(OPTIONS);
  await buttons[pick % buttons.length].click();

  // feedback lands first: the runner reveals the answer and the explanation
  await page.waitForSelector('.is-right, .is-reveal');
  await page.waitForTimeout(400);                     // the runner arms the tap at 350ms
  await page.click('#stage', { position:{ x:4, y:4 }, force:true }).catch(() => {});

  // gone (stage finished) or replaced (next question)
  await page.waitForFunction(
    prev => { const c = document.querySelector('.qcard'); return !c || c.innerHTML !== prev; },
    before, { timeout: 8000 });
}

/** Answer questions until the stage ends, at most `max`. Returns how many. */
export async function answerAll(page, max = 8){
  let n = 0;
  while(n < max && await page.$(OPTIONS)){ await answer(page, 0); n++; }
  return n;
}

/** The progress the app has actually persisted, as an object. */
export const savedProgress = page =>
  page.evaluate(() => JSON.parse(localStorage.getItem('vocab-progress') || '{}'));

/** The usage log once the app has written it to the page's own storage.
 *  It is written a moment after the last event, so wait until `until`
 *  holds for it rather than reading whatever happens to be there. */
export async function savedEvents(page, until = evs => evs.length > 0){
  const fn = `(${until})(JSON.parse(localStorage.getItem('vocab-events') || '{"events":[]}').events)`;
  await page.waitForFunction(fn, null, { timeout: 8000 });
  return page.evaluate(() => JSON.parse(localStorage.getItem('vocab-events')));
}

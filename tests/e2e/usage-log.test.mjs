/* The usage log, as the app actually writes it.
 *
 * What is checked here is what an analysis would later lean on: that a
 * quiz answer carries its time and the option that was tapped, that a
 * review grade carries the interval it was measured against, that a
 * tooltip lookup names its passage, that errors on the live site are not
 * lost - and that none of it leaves the device unless the learner exports it.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openApp, browserSkip, answer, savedEvents } from '../helpers/browser.mjs';
import { progress, daysAgo } from '../helpers/seed.mjs';

describe('usage log', { skip: browserSkip ?? false, concurrency: 1 }, () => {
  let app;
  before(async () => { app = await openApp(); });
  after(async () => { await app.close(); });

  const has = e => new Function('evs', `return evs.some(x => x.e === ${JSON.stringify(e)})`);

  test('opening the app logs one line about the sitting', async () => {
    const page = await app.page(progress({ ids:[0,1,2], next: daysAgo(1) }));
    const { uid, events } = await savedEvents(page, has('open'));
    assert.ok(uid, 'the log carries an anonymous install id');
    const open = events.find(x => x.e === 'open');
    assert.equal(open.storage, 'browser');
    assert.deepEqual([open.due, open.opened], [3, 3]);
    assert.ok(events.some(x => x.e === 'screen' && x.name === 'home'));
    await page.close_();
  });

  test('a recall answer carries its mechanic, word, tapped option and time', async () => {
    const page = await app.page(progress({ ids:[0,1,2,3,4], lessons:{ 1:'recall' } }));
    await page.click('#lesson');
    await page.waitForSelector('.cloze');
    await answer(page, 0);
    const { events } = await savedEvents(page, has('answer'));
    const a = events.find(x => x.e === 'answer');
    assert.equal(a.at, 'recall');
    assert.equal(a.k, 'gap');
    assert.equal(a.l, 1);
    assert.ok([0,1,2,3,4].includes(a.w), 'the word asked about is one of the lesson\'s');
    assert.ok(Number.isInteger(a.pick) && a.pick >= 0 && a.pick < 4);
    assert.equal(a.ok, a.pick === 0, 'option 0 is the answer before shuffling');
    assert.ok(a.ms > 0 && a.ms < 60000, `a plausible answer time, got ${a.ms}`);
    assert.ok(events.some(x => x.e === 'screen' && x.name === 'lesson' && x.l === 1 && x.st === 1),
      'the stage the lesson was on is in the log');
    await page.close_();
  });

  test('a typed recall answer logs what was typed and which cloze card asked it', async () => {
    const page = await app.page(progress({ ids:[0,1,2,3,4], lessons:{ 1:'recall' } }),
      { settings:{ typeCloze:true } });
    await page.click('#lesson');
    await page.waitForSelector('.typein');
    await page.fill('.typein', 'zzz-not-a-word');
    await page.press('.typein', 'Enter');
    const { events } = await savedEvents(page, has('answer'));
    const a = events.find(x => x.e === 'answer');
    assert.deepEqual({ ok: a.ok, out: a.out, pick: a.pick, said: a.said },
      { ok: false, out: 'wrong', pick: null, said: 'zzz-not-a-word' });
    assert.match(a.card, /^\d+:\d+$/, 'the cloze card that was asked');
    await page.close_();
  });

  test('a tooltip lookup in reading practice names the passage it happened in', async () => {
    const page = await app.page(progress({ ids:[0,1,2,3,4], reading: daysAgo(1) }));
    await page.click('#reading');
    await page.waitForSelector('.story mark');
    await page.click('.story mark');
    await page.waitForSelector('.tooltip');
    const { events } = await savedEvents(page, has('peek'));
    const shown = events.find(x => x.e === 'passage');
    const peek = events.find(x => x.e === 'peek');
    assert.equal(shown.why, 'due');
    assert.equal(peek.p, shown.p, 'the lookup belongs to the text on screen');
    assert.equal(typeof peek.w, 'number');
    await page.close_();
  });

  test('a review grade records the interval it was measured against', async () => {
    const page = await app.page(progress({ ids:[0], next: daysAgo(1), box: 1 }));
    await page.click('#review');
    await page.click('#show');
    await page.waitForSelector('.grade');
    await page.click('[data-g="2"]');
    const { events } = await savedEvents(page, has('grade'));
    const reveal = events.find(x => x.e === 'reveal');
    const grade = events.find(x => x.e === 'grade');
    assert.ok(['cloze', 'meaning'].includes(reveal.mode));
    assert.deepEqual({ w: grade.w, g: grade.g, box: grade.box, elapsed: grade.elapsed, overdue: grade.overdue },
      { w: 0, g: 2, box: 1, elapsed: 1, overdue: 1 }, 'the grade must be logged against the old interval');
    await page.close_();
  });

  test('an error nobody caught still ends up in the log', async () => {
    const page = await app.page();
    await page.evaluate(() => setTimeout(() => { throw new Error('usage-log-probe'); }, 0));
    const { events } = await savedEvents(page, has('error'));
    assert.match(events.find(x => x.e === 'error').msg, /usage-log-probe/);
    await page.close_();
  });

  test('a page restored in the background repaints without a view transition',
    async () => {
      const page = await app.page(progress({ ids:[0,1,2] }));
      await page.waitForSelector('#list');
      await page.emulateMedia({ reducedMotion: 'no-preference' });   // so motion is on the table at all
      await page.evaluate(() => {
        window.__transitions = 0;
        const real = document.startViewTransition?.bind(document);
        document.startViewTransition = cb => { window.__transitions++; return real(cb); };
        Object.defineProperty(document, 'visibilityState', { configurable:true, get: () => 'hidden' });
      });
      await page.click('#list');
      await page.waitForSelector('.list');
      assert.equal(await page.evaluate(() => window.__transitions), 0, 'hidden: painted directly');
      await page.close_();
    });

  test('a view transition the browser skips is not logged as an error', async () => {
    const page = await app.page(progress({ ids:[0,1,2] }));
    await page.waitForSelector('#list');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => {
      // what Safari hands back when it skips: every promise rejected
      const skipped = () => Promise.reject(new DOMException(
        'View transition was skipped because document visibility state is hidden.', 'InvalidStateError'));
      document.startViewTransition = cb => { cb();
        return { ready: skipped(), finished: skipped(), updateCallbackDone: Promise.resolve() }; };
    });
    await page.click('#list');
    await page.waitForSelector('.list');
    await page.click('[data-back]');
    await page.waitForSelector('#list');
    const { events } = await savedEvents(page, evs => evs.filter(x => x.e === 'screen').length >= 3);
    assert.deepEqual(events.filter(x => x.e === 'error').map(x => x.msg), []);
    await page.close_();
  });

  test('one trip away is one leave, however many hide signals the browser sends', async () => {
    const page = await app.page();
    await page.waitForSelector('#list');
    const hide = state => page.evaluate(s => {
      Object.defineProperty(document, 'visibilityState', { configurable:true, get: () => s });
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);
    await hide('hidden'); await hide('hidden');                  // iOS, twice in 25 ms
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await hide('visible');
    await hide('hidden');                                        // a second, real trip away
    const { events } = await savedEvents(page, has('leave'));
    assert.equal(events.filter(x => x.e === 'leave').length, 2);
    await page.close_();
  });

  test('settings shows the log and exports it, with the progress, as a file', async () => {
    const page = await app.page(progress({ ids:[0,1] }));
    await page.click('#settings');
    await page.waitForSelector('#logExport');
    assert.match((await page.textContent('#screen')).replace(/\s+/g, ' '), /never sent anywhere/);
    assert.ok(await page.$eval('#logExport', b => b.classList.contains('ghost')),
      'exporting is not the action of the settings screen');

    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#logExport')]);
    assert.match(download.suggestedFilename(), /^contextlearn-log-\d{4}-\d{2}-\d{2}\.json$/);
    const file = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.equal(file.app, 'ContextLearn');
    assert.ok(file.uid);
    assert.deepEqual(Object.keys(file.progress.words), ['0', '1']);
    assert.ok(file.events.some(x => x.e === 'screen' && x.name === 'settings'));
    await page.close_();
  });

  test('the developer card turns the log into words and texts, and can clear it', async () => {
    const t = Date.now(), s = 'seed', b = 'x';
    const events = { uid:'seeded', events: [
      { t, s, b, e:'answer', k:'gap', w:0, p:3, ok:false, ms:4000 },
      { t, s, b, e:'answer', k:'gap', w:0, ok:false, ms:3000 },
      { t, s, b, e:'grade', w:0, g:0 },
      { t, s, b, e:'error', msg:'<b>not markup</b>', at:'app.js:1:1' }
    ]};
    const page = await app.page(progress({ ids:[0] }), { events, settings:{ devMode:true } });
    await page.click('#settings');
    await page.waitForSelector('#logClear');
    const text = (await page.innerText('#screen')).replace(/\s+/g, ' ');
    assert.match(text, /Hardest words/);
    assert.match(text, /\b\w+ 3 missed of 3\b/);
    assert.match(text, /#3 · \w+ 1 missed · 0 lookups/);
    assert.doesNotMatch(text, /Lessons reaching/, 'no lesson in the log, so no funnel to show');
    assert.match(text, /<b>not markup<\/b>/, 'an error message is shown as text, never rendered');

    await page.click('#logClear');
    await page.waitForSelector('.fb.ok');
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('vocab-events')));
    assert.ok(!kept.events.some(x => x.s === 'seed'), 'clearing left the old events behind');
    assert.equal(kept.uid, 'seeded', 'clearing the log keeps the install id');
    await page.close_();
  });

  test('nothing the app does sends a request anywhere but its own origin', async () => {
    const page = await app.page(progress({ ids:[0,1,2,3,4], reading: daysAgo(1), next: daysAgo(1) }));
    await page.click('#reading');
    await page.waitForSelector('.story mark');
    await page.click('.story mark');
    await page.click('#quiz');
    await answer(page, 0);
    await savedEvents(page, has('answer'));
    const elsewhere = await page.evaluate(origin => performance.getEntriesByType('resource')
      .map(r => r.name).filter(n => !n.startsWith(origin)), app.origin);
    assert.deepEqual(elsewhere, []);
    await page.close_();
  });
});

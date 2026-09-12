/* Settings: the +5 grant, the credits, and the developer card.
 *
 * The grant is the one place the daily cap can be moved, and CLAUDE.md is
 * strict about how: one extra batch that ages out of the same rolling 24
 * hours, never a raised cap. The developer card is checked because a reset
 * with no confirmation would be the most expensive bug in the app.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, browserSkip, savedProgress } from '../helpers/browser.mjs';
import { progress, afterFirstLesson } from '../helpers/seed.mjs';

describe('settings', { skip: browserSkip ?? false, concurrency: 1 }, () => {
  let app;
  before(async () => { app = await openApp(); });
  after(async () => { await app.close(); });

  const openSettings = async state => {
    const page = await app.page(state);
    await page.click('#settings');
    await page.waitForSelector('#plus5');
    return page;
  };

  test('it says where progress is being saved', async () => {
    const page = await openSettings();
    assert.match(await page.textContent('.card .muted'), /Saving to: (browser|app)/);
    await page.close_();
  });

  test('it shows how many new words are ready right now', async () => {
    const page = await openSettings();
    assert.match((await page.textContent('.row')).replace(/\s+/g,' '), /Ready to open now\s*5/);
    await page.close_();
  });

  test('+5 opens one extra batch and says what it did', async () => {
    const page = await openSettings(afterFirstLesson({ opened: 1 }));
    assert.match((await page.textContent('.row')).replace(/\s+/g,' '), /Ready to open now\s*0/);

    await page.click('#plus5');
    await page.waitForSelector('.fb.ok');
    assert.match(await page.textContent('.fb.ok'), /Five more words opened\. 5 waiting/);

    const saved = await savedProgress(page);
    assert.equal(saved.grants.length, 1, 'a grant is one timestamp, not a raised setting');
    await page.close_();
  });

  test('the grant reaches the home screen as something that can be pressed', async () => {
    const page = await openSettings(afterFirstLesson({ opened: 1 }));
    await page.click('#plus5');
    await page.waitForSelector('.fb.ok');
    await page.click('.backlink');
    await page.waitForSelector('.gauge');
    assert.deepEqual(await page.$eval('#lesson', b => ({ text:b.textContent, off:b.disabled })),
      { text:'Learn', off:false });
    await page.close_();
  });

  test('the recordings are credited in the app, as their licences ask', async () => {
    const page = await openSettings();
    const credits = await page.textContent('#screen');
    assert.match(credits, /Pronunciations/);
    assert.match(credits, /Wiktionary/);
    assert.match(credits, /CC BY-SA/);
    await page.close_();
  });

  test('the developer card is not reachable by accident', async () => {
    const page = await openSettings();
    assert.equal(await page.$('#devDelete'), null);
    for(let tap = 0; tap < 4; tap++) await page.click('#tap');
    await page.waitForTimeout(100);
    assert.equal(await page.$('#devDelete'), null, 'four taps must not unlock anything');
    await page.close_();
  });

  test('five taps unlock it, and it says so rather than appearing silently', async () => {
    const page = await openSettings();
    for(let tap = 0; tap < 5; tap++) await page.click('#tap');
    await page.waitForSelector('#devDelete');
    assert.match(await page.textContent('.fb.ok'), /Developer mode unlocked/);
    await page.close_();
  });

  test('deleting everything asks first, and cancelling really cancels', async () => {
    const page = await openSettings(progress({ ids:[0,1,2] }));
    for(let tap = 0; tap < 5; tap++) await page.click('#tap');
    await page.waitForSelector('#devDelete');

    await page.click('#devDelete');
    await page.waitForSelector('#devYes');
    assert.match(await page.textContent('.fb.no'), /cannot be undone/);

    await page.click('#devNo');
    await page.waitForSelector('#devDelete');
    assert.equal(Object.keys((await savedProgress(page)).words).length, 3, 'cancel deleted progress');
    await page.close_();
  });

  test('confirming the delete really does wipe it and go home', async () => {
    const page = await openSettings(progress({ ids:[0,1,2] }));
    for(let tap = 0; tap < 5; tap++) await page.click('#tap');
    await page.waitForSelector('#devDelete');
    await page.click('#devDelete');
    await page.waitForSelector('#devYes');
    await page.click('#devYes');
    await page.waitForSelector('.gauge');

    assert.deepEqual((await savedProgress(page)).words, {});
    assert.equal(await page.textContent('.gnum'), '0%');
    assert.deepEqual(page.errors, []);
    await page.close_();
  });

  test('developer mode is an app preference, not learning progress', async () => {
    const page = await openSettings();
    for(let tap = 0; tap < 5; tap++) await page.click('#tap');
    await page.waitForSelector('#devDelete');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('vocab-settings'))),
      { devMode: true });
    assert.equal((await savedProgress(page)).devMode, undefined,
      'preferences live in their own key, away from progress');
    await page.close_();
  });
});

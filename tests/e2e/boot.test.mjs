/* Booting: old saves, broken saves, and the stale-build reload.
 *
 * Everything here is about the app surviving a start it did not expect. A
 * learner's device carries progress written by an older version of this app,
 * sometimes a corrupted copy of it, and sometimes a tab that has been asleep
 * for a week and is running code that no longer exists. None of those may
 * end in a blank screen.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, browserSkip, savedProgress } from '../helpers/browser.mjs';
import { progress, daysAgo } from '../helpers/seed.mjs';

describe('booting', { skip: browserSkip ?? false, concurrency: 1 }, () => {
  let app;
  before(async () => { app = await openApp(); });
  after(async () => { await app.close(); });

  test('a fresh device boots to a working home screen', async () => {
    const page = await app.page();
    await page.waitForSelector('.gauge');
    assert.deepEqual(page.errors, []);
    assert.deepEqual(page.logged, [], 'nothing the page loads may 404');
    await page.close_();
  });

  test('progress that is not JSON at all does not stop the app', async () => {
    const page = await app.page();
    await page.evaluate(() => localStorage.setItem('vocab-progress', 'half a file{{{'));
    await page.reload();
    await page.waitForSelector('.gauge');
    assert.equal(await page.textContent('.gnum'), '0%');
    assert.deepEqual(page.errors, [], 'a corrupt save must be ignored, not thrown');
    await page.close_();
  });

  test('progress missing the compartments a newer version added still loads', async () => {
    // a save written before the daily cap and the reading schedule existed:
    // no `new` stamp, no grants, no rsched
    const page = await app.page({ words: { 0: { box:1, right:1, wrong:0, seen:0,
                                                next: daysAgo(1), lastSeen: '2024-01-01' } } });
    await page.waitForSelector('.gauge');
    assert.match(await page.textContent('#review'), /Review 1 word/);

    // the missing compartments are filled in as the save is read; they reach
    // storage the next time anything is written, so write something
    await page.click('#settings');
    await page.waitForSelector('#plus5');
    await page.click('#plus5');
    await page.waitForSelector('.fb.ok');

    const saved = await savedProgress(page);
    assert.ok(Array.isArray(saved.grants), 'grants was added later and must be filled in');
    assert.ok(saved.rsched && saved.log, 'the newer compartments are there');
    assert.equal(saved.words['0'].new, Date.parse('2024-01-01T12:00'),
      'a word opened before the cap existed is dated from when it was last seen');
    assert.deepEqual(page.errors, []);
    await page.close_();
  });

  test('a save from the single-file version is not walked back through finished lessons', async () => {
    const page = await app.page({
      words: Object.fromEntries([0,1,2,3,4].map(id =>
        [id, { box:2, right:2, wrong:0, seen:2, next: daysAgo(1), lastSeen:'2024-01-01' }])),
      streak: 3, last: '2024-01-01'          // kept by that version, read by nothing now
    });
    await page.waitForSelector('.gauge');
    const saved = await savedProgress(page);
    assert.equal(saved.lesson['1'], 'done',
      'lesson 1\'s five words are all open, so the lesson is finished');
    assert.ok(!('streak' in saved) && !('last' in saved),
      'keys nothing reads are written out of the save, not carried forever');
    await page.close_();
  });

  test('a tab running replaced code reloads itself, exactly once', async () => {
    const page = await app.page(progress({ ids:[0] }));

    let loads = 0;
    page.on('load', () => loads++);
    await page.route('**/version.txt', route =>
      route.fulfill({ status:200, contentType:'text/plain', body:'19990101-0000-oldbuild' }));

    await page.reload();
    await page.waitForSelector('.gauge');
    await page.waitForTimeout(1500);

    assert.equal(await page.evaluate(() => sessionStorage.getItem('reloaded-for-build')),
      '19990101-0000-oldbuild');
    assert.equal(loads, 2, `the page reloaded ${loads - 1} times - a cache that refuses to let go must not loop`);
    assert.deepEqual(page.errors, []);
    await page.close_();
  });

  test('a build id that matches leaves the page where it is', async () => {
    const page = await app.page(progress({ ids:[0] }));
    let loads = 0;
    page.on('load', () => loads++);
    await page.reload();
    await page.waitForSelector('.gauge');
    await page.waitForTimeout(1200);
    assert.equal(loads, 1);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('reloaded-for-build')), null);
    await page.close_();
  });

  test('being offline is not an error - the app keeps running', async () => {
    const page = await app.page(progress({ ids:[0] }));
    await page.route('**/version.txt', route => route.abort());
    await page.reload();
    await page.waitForSelector('.gauge');
    await page.waitForTimeout(800);
    assert.ok(await page.$('#list'), 'the app carried on without the version check');
    assert.deepEqual(page.errors, [],
      'a failed version check must be caught - the browser logging the dead request is expected');
    await page.close_();
  });
});

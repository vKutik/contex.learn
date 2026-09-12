/* The review screen: recall, reveal, grade.
 *
 * The screen itself is small; what matters is that the grade a learner taps
 * becomes the date srs.js promised, and that a forgotten word really does
 * come back in the same sitting rather than tomorrow.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, browserSkip, savedProgress } from '../helpers/browser.mjs';
import { progress, daysAgo, dateIn } from '../helpers/seed.mjs';

describe('review', { skip: browserSkip ?? false, concurrency: 1 }, () => {
  let app;
  before(async () => { app = await openApp(); });
  after(async () => { await app.close(); });

  const due = (n, over = {}) =>
    progress({ ids: Array.from({length:n}, (_,i) => i), next: daysAgo(1), ...over });

  const startReview = async state => {
    const page = await app.page(state);
    await page.click('#review');
    await page.waitForSelector('#show');
    return page;
  };

  test('it asks for recall before it shows anything', async () => {
    const page = await startReview(due(3));
    assert.deepEqual(await page.$$eval('.pill', p => p.map(x => x.textContent)),
      ['Review 1 of 3', 'Started']);
    assert.equal(await page.$$eval('.grade', e => e.length), 0, 'the grades are not offered yet');
    assert.match(await page.textContent('.card'), /Recall it yourself/);
    await page.close_();
  });

  test('revealing shows the same card face the lesson showed', async () => {
    const page = await startReview(due(1));
    await page.click('#show');
    await page.waitForSelector('.grade');
    for(const part of ['.word','.pos','.def','.ex','[data-say]'])
      assert.ok(await page.$(part), `the reveal is missing ${part}`);
    await page.close_();
  });

  test('the four grades are offered, and each says what it will do', async () => {
    const page = await startReview(due(1));
    await page.click('#show');
    await page.waitForSelector('.grade');
    assert.deepEqual(await page.$$eval('.grade button', bs =>
      bs.map(b => b.textContent.replace(b.querySelector('small').textContent, '').trim())),
      ['Forgot','Hard','Good','Easy']);
    assert.deepEqual(await page.$$eval('.grade small', ss => ss.map(s => s.textContent)),
      ['again today','same interval','next interval','skip an interval']);
    await page.close_();
  });

  test('Good moves the word on and sets the date the button promised', async () => {
    const page = await startReview(due(1, { box:0 }));
    await page.click('#show');
    await page.waitForSelector('[data-g="2"]');
    await page.click('[data-g="2"]');
    await page.waitForSelector('.pagehead h1');

    const saved = await savedProgress(page);
    assert.equal(saved.words['0'].box, 1);
    assert.equal(saved.words['0'].next, dateIn(3), 'box 1 is three days out');
    assert.equal(saved.words['0'].right, 1);
    await page.close_();
  });

  test('Forgot sends the word back to day one and asks it again in the same sitting', async () => {
    const page = await startReview(due(1, { box:3 }));
    await page.click('#show');
    await page.waitForSelector('[data-g="0"]');
    await page.click('[data-g="0"]');
    await page.waitForSelector('#show');

    assert.equal(await page.textContent('.pill'), 'Review 2 of 2',
      'a forgotten word joins the back of today\'s queue');
    const saved = await savedProgress(page);
    assert.equal(saved.words['0'].box, 0);
    assert.equal(saved.words['0'].next, dateIn(1));
    await page.close_();
  });

  test('the session ends with what was done, and one way out', async () => {
    const page = await startReview(due(2));
    for(let i = 0; i < 2; i++){
      await page.click('#show');
      await page.waitForSelector('[data-g="2"]');
      await page.click('[data-g="2"]');
      await page.waitForTimeout(150);
    }
    await page.waitForSelector('.pagehead h1');
    assert.equal(await page.textContent('.pagehead h1'), 'Session done');
    const rows = (await page.textContent('.card')).replace(/\s+/g,' ');
    assert.match(rows, /Reviewed\s*2/);
    assert.match(rows, /Right today\s*2/);
    assert.match(rows, /Forgotten today\s*0/);

    assert.deepEqual(page.errors, []);
    await page.close_();
  });

  test('reviewing never touches the reading schedule', async () => {
    const page = await startReview(due(1, { reading: dateIn(9), readingStep: 3 }));
    await page.click('#show');
    await page.waitForSelector('[data-g="3"]');
    await page.click('[data-g="3"]');
    await page.waitForSelector('.pagehead h1');
    assert.deepEqual((await savedProgress(page)).rsched['0'], { step:3, next: dateIn(9) });
    await page.close_();
  });
});

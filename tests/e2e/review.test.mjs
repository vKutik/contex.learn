/* The review screen: recall, reveal, grade.
 *
 * The screen itself is small; what matters is that the grade a learner taps
 * becomes the date srs.js promised, that a forgotten word really does come
 * back soon rather than tomorrow, and that none of this can make the sitting
 * look bigger than it started - a wrong answer used to push the total up and
 * that is the exact complaint this screen exists to fix.
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

  /** The "Done x of y" pill, parsed. */
  const donePill = async page => {
    const text = await page.textContent('.pill');
    const m = text.match(/^Done (\d+) of (\d+)$/);
    assert.ok(m, `pill did not read "Done n of m": "${text}"`);
    return { done: +m[1], total: +m[2] };
  };

  test('it asks for recall before it shows anything', async () => {
    const page = await startReview(due(3));
    assert.deepEqual(await page.$$eval('.pill', p => p.map(x => x.textContent)),
      ['Done 0 of 3', 'Started']);
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
      ['again soon','same interval','next interval','skip an interval']);
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

  test('Forgot brings the word back soon, in the same sitting, without growing it', async () => {
    const page = await startReview(due(3, { box:3 }));
    let pill = await donePill(page);
    assert.deepEqual(pill, { done:0, total:3 });

    await page.click('#show');
    await page.waitForSelector('[data-g="0"]');
    const forgotten = (await page.textContent('.card .word')).trim();
    await page.click('[data-g="0"]');
    await page.waitForSelector('#show', { timeout: 5000 }); // asked again, not the done screen

    pill = await donePill(page);
    assert.deepEqual(pill, { done:0, total:3 },
      'still not finished, and the total never grew past the three words due');
    const saved = await savedProgress(page);
    const rec = Object.values(saved.words).find(w => w.seen === 1);
    assert.equal(rec.box, 0);
    assert.equal(rec.next, dateIn(1));

    // two other cards come first, then the forgotten one
    const seenNext = [];
    for(let i = 0; i < 3; i++){
      await page.click('#show');
      await page.waitForSelector('.grade');
      seenNext.push((await page.textContent('.card .word')).trim());
      await page.click('[data-g="2"]');
      await Promise.race([page.waitForSelector('#show'), page.waitForSelector('.pagehead h1')]);
    }
    assert.equal(seenNext.indexOf(forgotten), 2, `came back after two others: ${seenNext}`);
    await page.close_();
  });

  test('a tricky word is still asked as a cloze, in a sentence it has not met', async () => {
    const state = due(1, { clozeSeen:{ 0:['0:3'] } });   // seen 0 asks the cloze
    state.words[0].wrong = 6;
    const page = await startReview(state);
    assert.ok(await page.$('.cloze'), 'context practice is kept for the words that need it most');
    await page.click('#show');
    await page.click('[data-g="2"]');
    await page.waitForFunction(() =>
      JSON.parse(localStorage.getItem('vocab-progress')).clozeSeen[0].length === 2);
    const seen = (await savedProgress(page)).clozeSeen[0];
    assert.notEqual(seen[1], '0:3', 'a fresh sentence, not the one already met');
    await page.close_();
  });

  test('a word forgotten and then remembered in the same sitting reaches box 1, not box 2', async () => {
    const state = due(3, { box:3 });
    for(const w of Object.values(state.words)) w.right = 4;   // not a word that was never known
    const page = await startReview(state);
    const shownWord = async () => { await page.click('#show'); await page.waitForSelector('.grade');
                                    return (await page.textContent('.card .word')).trim(); };
    const first = await shownWord();
    await page.click('[data-g="0"]');                        // forget the first card
    for(let i = 0; i < 4; i++){
      await page.waitForSelector('#show');
      const w = await shownWord();
      const again = w === first;
      await page.click(`[data-g="${again ? 3 : 2}"]`);       // Easy when it comes back
      if(again) break;
    }
    await page.waitForFunction(() => {
      const p = JSON.parse(localStorage.getItem('vocab-progress'));
      return Object.values(p.words).filter(w => w.seen === 2).length === 1;
    });
    const saved = await savedProgress(page);
    const rec = Object.values(saved.words).find(w => w.seen === 2);
    assert.equal(rec.box, 1, 'remembered forty seconds after being shown is not a week of memory');
    assert.equal(rec.next, dateIn(3));
    await page.close_();
  });

  test('a forgotten word with nothing left to put between is named under "Back tomorrow"', async () => {
    // one word alone: nothing to put between, so a single Forgot sends it to tomorrow
    const page = await startReview(due(1, { box:2 }));
    await page.click('#show');
    await page.waitForSelector('[data-g="0"]');
    await page.click('[data-g="0"]');
    await page.waitForSelector('.pagehead h1');
    assert.equal(await page.textContent('.pagehead h1'), 'Session done');
    const card = (await page.textContent('.card')).replace(/\s+/g,' ');
    assert.match(card, /Remembered\s*0/);
    assert.match(card, /Back tomorrow/);
    assert.match(card, /shallow/, 'the dropped word is named');
    await page.close_();
  });

  test('the session ends with what was remembered, and one way out', async () => {
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
    assert.match(rows, /Remembered\s*2/);
    assert.doesNotMatch(rows, /Back tomorrow/, 'nothing was dropped');

    assert.equal(await page.$('#more'), null, 'nothing left due, so no "Next" button');
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

  test('a big backlog is still a small sitting, and a miss cannot grow the total', async () => {
    const page = await app.page(due(12));
    assert.equal(await page.textContent('#review'), 'Review 7 words',
      'the button offers a sitting, not the whole backlog');
    await page.click('#review');
    await page.waitForSelector('#show');

    let lastDone = -1;
    let ended = false;
    for(let i = 0; i < 20 && !ended; i++){
      const { done, total } = await donePill(page);
      assert.equal(total, 7, 'the total holds however many were graded');
      assert.ok(done >= lastDone, `the counter went from ${lastDone} to ${done}`);
      lastDone = done;

      await page.click('#show');
      await page.waitForSelector('.grade');
      await page.click(`[data-g="${i < 4 ? 0 : 2}"]`);   // forget a few, then remember the rest
      await Promise.race([
        page.waitForSelector('#show'),
        page.waitForSelector('.pagehead h1')
      ]);
      ended = await page.$('.pagehead h1') !== null;
    }

    assert.equal(await page.textContent('.pagehead h1'), 'Session done');
    assert.equal(await page.textContent('#more'), 'Next 5 words',
      '12 due, 7 taken into the sitting, 5 still waiting');
    await page.close_();
  });
});

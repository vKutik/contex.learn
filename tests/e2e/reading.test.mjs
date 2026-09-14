/* Reading practice: the schedule, the shelves, and the line between them.
 *
 * The rule this suite exists for is CLAUDE.md 12 and 14: the schedule decides
 * what comes back, and extra practice must never move a due date. That is a
 * promise made to the learner in the interface ("Reading them costs you
 * nothing"), and it is only worth anything if it is true of what gets saved.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, browserSkip, answer, savedProgress } from '../helpers/browser.mjs';
import { progress, daysAgo, dateIn } from '../helpers/seed.mjs';

describe('reading practice', { skip: browserSkip ?? false, concurrency: 1 }, () => {
  let app;
  before(async () => { app = await openApp(); });
  after(async () => { await app.close(); });

  const open = (over = {}) => progress({ ids:[0,1,2,3,4], reading: daysAgo(1), ...over });

  const startReading = async state => {
    const page = await app.page(state);
    await page.click('#reading');
    await page.waitForSelector('.story');
    return page;
  };

  test('a due word arrives with its text, its count and its three ways on', async () => {
    const page = await startReading(open());
    assert.match(await page.textContent('.muted'), /\b0 of 10 answered\b/);
    assert.match(await page.textContent('.muted'), /\d+ more waiting/);
    assert.deepEqual(await page.$$eval('#screen button.go', bs => bs.map(b => b.id)),
      ['quiz','more','another']);
    assert.equal(await page.$$eval('#screen button.go:not(.ghost)', e => e.length), 1);
    await page.close_();
  });

  test('the text marks its word, and credits the book when it came from one', async () => {
    const page = await startReading(open());
    assert.ok(await page.$$eval('.story mark', m => m.length) >= 1,
      'the word the text is for must be marked in it');
    const source = await page.$('.source');
    if(source) assert.match((await source.textContent()).trim(), /\S+ — \S+/,
      'a credited passage names the book and its author');
    await page.close_();
  });

  test('"another text" stays on the same word and gives a different passage', async () => {
    const page = await startReading(open());
    const word = await page.textContent('.muted');
    const first = await page.textContent('.story');
    await page.click('#more');
    await page.waitForSelector('.story');
    assert.notEqual(await page.textContent('.story'), first, 'the shelf served the same text twice');
    assert.equal((await page.textContent('.muted')).split('·')[0], word.split('·')[0],
      '"another text" must not change the word');
    await page.close_();
  });

  test('"another word" walks the queue instead of bouncing between its top two', async () => {
    const page = await startReading(open());
    const seen = [];
    for(let i = 0; i < 3; i++){
      seen.push((await page.textContent('.muted')).split('·')[0].trim());
      await page.click('#another');
      await page.waitForSelector('.story');
    }
    assert.equal(new Set(seen).size, 3, `walked ${seen.join(' -> ')}`);
    await page.close_();
  });

  test('browsing the shelf moves nothing at all - no due date, no schedule', async () => {
    const state = open({ next: dateIn(6), readingStep: 2 });
    const page = await startReading(state);
    for(let i = 0; i < 3; i++){ await page.click('#more'); await page.waitForSelector('.story'); }
    await page.click('#another');
    await page.waitForSelector('.story');

    const saved = await savedProgress(page);
    assert.deepEqual(saved.words, state.words, 'reading changed a review date');
    assert.deepEqual(saved.rsched, state.rsched, 'reading changed the reading schedule');
    assert.deepEqual(saved.read, {}, 'a text is only read once its question is answered');
    await page.close_();
  });

  test('answering from the text marks the passage, widens its gap, and leaves the review date alone',
    async () => {
      const state = open({ next: dateIn(6), readingStep: 1 });
      const page = await startReading(state);
      await page.click('#quiz');
      await page.waitForSelector('[data-k]');
      await answer(page, 0);
      await page.waitForSelector('.pagehead h1');

      const saved = await savedProgress(page);
      assert.equal(Object.keys(saved.read).length, 1, 'the passage was not marked read');
      assert.deepEqual(saved.words, state.words,
        'the review schedule is the review screen\'s job alone');

      const moved = Object.entries(saved.rsched)
        .filter(([id, plan]) => plan.next !== state.rsched[id].next);
      assert.equal(moved.length, 1, 'exactly one word\'s reading date moves');
      assert.deepEqual(page.errors, []);
      await page.close_();
    });

  test('a right answer turns the word amber - proved from the passage, not from a card', async () => {
    const page = await startReading(open());
    await page.click('#quiz');
    await page.waitForSelector('[data-k]');
    // press every option in turn across runs is not possible here, so accept
    // either outcome and assert the rule that holds for both
    await answer(page, 0);
    await page.waitForSelector('.pagehead h1');
    const saved = await savedProgress(page);
    const score = await page.textContent('.pagehead h1');
    if(score.startsWith('1')) assert.equal(Object.keys(saved.rw).length, 1);
    else assert.deepEqual(saved.rw, {}, 'a miss must not prove the word');
    await page.close_();
  });

  test('the score screen offers more of the same word, the next word, or this one again', async () => {
    const page = await startReading(open());
    await page.click('#quiz');
    await page.waitForSelector('[data-k]');
    await answer(page, 0);
    await page.waitForSelector('.pagehead h1');
    assert.deepEqual(await page.$$eval('#screen button.go', bs => bs.map(b => b.id)),
      ['more','another','again']);
    await page.close_();
  });

  test('with nothing due it says so, and still lets the learner read on', async () => {
    const page = await app.page(progress({ ids:[0,1], reading: dateIn(4) }));
    await page.click('#reading');
    await page.waitForSelector('.card');
    assert.match(await page.textContent('.def'), /brings the next word back in 4 days/);
    assert.match(await page.textContent('.muted'), /Nothing is .*due/);
    assert.match(await page.textContent('.muted'), /20 more texts/);
    assert.match(await page.textContent('.muted'), /never moves a due date/);

    await page.click('#ahead');
    await page.waitForSelector('.story');
    assert.deepEqual((await savedProgress(page)).rsched,
      progress({ ids:[0,1], reading: dateIn(4) }).rsched,
      'reading ahead of schedule must not change the schedule');
    await page.close_();
  });

  test('the highlight steps back as a word settles', async () => {
    const quiet = await app.page(progress({ ids:[0], reading: daysAgo(1), proven:[0], box:4 }));
    await quiet.click('#reading');
    await quiet.waitForSelector('.story mark');
    const settled = await quiet.$eval('.story mark[data-word="shallow"]', m => m.className);
    await quiet.close_();

    const fresh = await app.page(progress({ ids:[0], reading: daysAgo(1) }));
    await fresh.click('#reading');
    await fresh.waitForSelector('.story mark');
    const newish = await fresh.$eval('.story mark[data-word="shallow"]', m => m.className);
    await fresh.close_();

    assert.equal(newish, 'lvl0', 'a new word is marked at the loudest level');
    assert.equal(settled, 'lvl3', 'a word already known does not need finding');
  });

  /* CLAUDE.md rule 12: extra practice never moves a due date - but "Another
   * word" also must not hand back a word this sitting has already checked.
   * Three words are due; two more are introduced but not due yet, so once
   * the due queue is spent there is somewhere fresh left to go. */
  const withSpare = () => {
    const state = progress({ ids:[0,1,2], reading: daysAgo(1) });
    const spare = progress({ ids:[3,4], reading: dateIn(3) });
    Object.assign(state.words, spare.words);
    Object.assign(state.rsched, spare.rsched);
    return state;
  };
  const checkOneAndMoveOn = async page => {
    await page.click('#quiz');
    await page.waitForSelector('[data-k]');
    await answer(page, 0);
    await page.waitForSelector('.pagehead h1');
    await page.click('#another');
    await page.waitForSelector('.story');
  };

  test('"Next word" never returns to a word already checked in this sitting', async () => {
    const page = await startReading(withSpare());
    const seen = [];
    for(let i = 0; i < 3; i++){
      seen.push((await page.textContent('.muted')).split('·')[0].trim());
      await checkOneAndMoveOn(page);
    }
    assert.equal(new Set(seen).size, 3, `the three due words were not distinct: ${seen.join(' -> ')}`);

    // the due queue is now empty - the word shown next must be one of the two
    // still-unchecked words, never one already answered a moment ago
    const fourth = (await page.textContent('.muted')).split('·')[0].trim();
    assert.ok(!seen.includes(fourth),
      `the fourth word repeated "${fourth}", already checked this sitting`);
    await page.close_();
  });

  test('once the due queue is spent, the screen says this is extra practice', async () => {
    const page = await startReading(withSpare());
    for(let i = 0; i < 3; i++) await checkOneAndMoveOn(page);
    assert.match(await page.textContent('.muted'), /extra practice/i);
    assert.match(await page.textContent('.muted'), /never moves a due date/i);
    await page.close_();
  });

  test('a word with nothing else left is still served, never a dead end', async () => {
    const page = await startReading(progress({ ids:[0], reading: daysAgo(1) }));
    await checkOneAndMoveOn(page);
    // must land back on a story, not bounce to home for lack of a candidate
    assert.match(await page.textContent('.story'), /\S/);
    await page.close_();
  });

  test('reading is offered only once a word has been opened', async () => {
    const page = await app.page();
    assert.equal(await page.$eval('#reading', b => b.disabled), true);
    await page.close_();
  });
});

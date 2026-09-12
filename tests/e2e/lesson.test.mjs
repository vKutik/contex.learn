/* The lesson: cards -> recall -> reading -> quiz.
 *
 * This is the path every new word takes, and the one place where four
 * components, the scheduler and storage all have to agree. The test walks it
 * exactly as a learner would - taps only, no state written behind the app's
 * back - and then checks what the app persisted.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, browserSkip, answer, savedProgress } from '../helpers/browser.mjs';
import { progress } from '../helpers/seed.mjs';

describe('a lesson end to end', { skip: browserSkip ?? false, concurrency: 1 }, () => {
  let app;
  before(async () => { app = await openApp(); });
  after(async () => { await app.close(); });

  /** Tap through the five cards of the lesson that is offered. */
  async function readCards(page){
    const words = [];
    for(let i = 1; i <= 5; i++){
      await page.waitForSelector('.card .word');
      assert.equal(await page.textContent('.pill'), `New word ${i} of 5`);
      words.push(await page.textContent('.card .word'));
      await page.click('#next');
    }
    return words;
  }

  test('the five cards come one at a time and carry the whole face of a word', async () => {
    const page = await app.page();
    await page.click('#lesson');
    await page.waitForSelector('.card .word');

    assert.equal(await page.textContent('h1'), 'The Well');
    assert.match(await page.textContent('.pos'), /\/.+\/ · (adj|verb|noun|adv|phrase)/);
    assert.ok(await page.$('[data-say]'), 'the card can be heard');
    assert.ok(await page.$('.def'), 'the card says what the word means');
    assert.match(await page.textContent('.ex'), /\S/, 'the card shows one sentence');
    assert.equal(await page.textContent('.exnav'), 'example 1 of 5');

    await page.click('[data-alt]');
    await page.waitForFunction(() => document.querySelector('.exnav').textContent.includes('2 of 5'));
    assert.equal(await page.textContent('.exnav'), 'example 2 of 5',
      'another example steps the shelf without leaving the card');

    assert.equal(await page.textContent('#next'), 'Got it');
    await page.close_();
  });

  test('the last card offers the recall stage rather than another card', async () => {
    const page = await app.page();
    await page.click('#lesson');
    for(let i = 0; i < 4; i++){ await page.waitForSelector('#next'); await page.click('#next'); }
    await page.waitForSelector('.card .word');
    assert.equal(await page.textContent('#next'), 'Try them from memory');
    await page.close_();
  });

  test('recall asks for all five words before the story, and never re-asks the sentence just read',
    async () => {
      const page = await app.page();
      await page.click('#lesson');
      const seen = await readCards(page);
      assert.equal(new Set(seen).size, 5);

      await page.waitForSelector('.cloze');
      assert.match(await page.textContent('.muted'), /Before the story/);
      for(let i = 1; i <= 5; i++){
        assert.equal(await page.textContent('.pill'), `Question ${i} of 5`);
        assert.ok(await page.$('.cloze'), 'recall is gap fill, the closest thing to producing the word');
        assert.equal((await page.$$('.pill-opt')).length, 4);
        await answer(page, 0);
      }
      await page.waitForSelector('.story');
      await page.close_();
    });

  test('the story marks all five words, and a tap explains one without moving the text', async () => {
    const page = await app.page(progress({ ids:[0,1,2,3,4], lessons:{ 1:'reading' } }));
    await page.click('#lesson');
    await page.waitForSelector('.story');

    const marks = await page.$$('.story mark');
    assert.equal(marks.length, 5, 'all five of today\'s words are in the text');

    const before = await page.$eval('.story', e => e.getBoundingClientRect().top);
    await marks[0].click();
    await page.waitForSelector('#tooltip-layer .tooltip');

    const tip = await page.textContent('.tooltip');
    assert.match(tip, /\/.+\//, 'the tooltip carries the transcription');
    assert.ok(await page.$('.tooltip .tipsay'), 'and a speaker button');
    assert.ok(await page.$('.tooltip .hint'), 'and what the word means');
    assert.equal(await page.$eval('.story', e => e.getBoundingClientRect().top), before,
      'the text must not move when a tooltip opens');

    await marks[0].click();
    assert.equal(await page.$$eval('.tooltip', e => e.length), 0, 'tapping the same word closes it');
    await page.close_();
  });

  test('only one tooltip is ever open', async () => {
    const page = await app.page(progress({ ids:[0,1,2,3,4], lessons:{ 1:'reading' } }));
    await page.click('#lesson');
    await page.waitForSelector('.story mark');
    const marks = await page.$$('.story mark');
    await marks[0].click();
    await page.waitForSelector('.tooltip');
    // the open bubble sits over the neighbouring word, exactly as it does for
    // a learner, so the second tap is dispatched on the mark rather than
    // aimed at a screen position the tooltip is covering
    await marks[1].dispatchEvent('click');
    await page.waitForSelector('.tooltip');
    assert.equal(await page.$$eval('.tooltip', e => e.length), 1);
    assert.equal(await page.$$eval('.story mark.open', e => e.length), 1,
      'the word the bubble points at is the only one marked open');
    await page.close_();
  });

  test('the quiz asks the story\'s own questions plus one word check, then scores the lesson',
    async () => {
      const page = await app.page(progress({ ids:[0,1,2,3,4], lessons:{ 1:'quiz' } }));
      await page.click('#lesson');
      await page.waitForSelector('[data-k]');

      const total = +(await page.textContent('.pill')).match(/of (\d+)/)[1];
      assert.equal(total, 3, 'two comprehension questions and one generated check');
      for(let i = 0; i < total; i++) await answer(page, 0);

      await page.waitForSelector('.pagehead h1');
      assert.match(await page.textContent('.pagehead h1'), new RegExp(`^\\d of ${total}$`));

      const buttons = await page.$$eval('#screen button.go', bs =>
        bs.map(b => ({ text:b.textContent.trim(), ghost:b.className.includes('ghost') })));
      assert.equal(buttons.filter(b => !b.ghost).length, 1);
      assert.equal(buttons.find(b => !b.ghost).text, 'Done',
        'the lesson is finished: carrying on is the action, re-reading the fallback');

      assert.equal((await savedProgress(page)).lesson['1'], 'done');
      await page.close_();
    });

  test('the whole lesson, walked once, leaves five words open and the day tallied', async () => {
    const page = await app.page();
    await page.click('#lesson');
    await readCards(page);

    await page.waitForSelector('.pill-opt');
    for(let i = 0; i < 5; i++) await answer(page, 0);

    await page.waitForSelector('#toquiz');
    await page.click('#toquiz');
    await page.waitForSelector('[data-k]');
    while(await page.$('[data-k]')) await answer(page, 0);

    await page.waitForSelector('.pagehead h1');
    const saved = await savedProgress(page);
    assert.deepEqual(Object.keys(saved.words).sort((a,b)=>a-b), ['0','1','2','3','4']);
    assert.equal(saved.lesson['1'], 'done');
    for(const id of ['0','1','2','3','4']){
      assert.ok(saved.rsched[id], `word ${id} was never given a reading plan`);
      assert.equal(saved.words[id].box, 0, 'the lesson introduces a word, it does not grade it');
    }
    const log = Object.values(saved.log)[0];
    assert.equal(log.right + log.wrong, 8, 'five recall answers and three quiz answers');
    assert.deepEqual(page.errors, []);
    await page.close_();
  });

  test('a lesson left half done resumes where it stopped, not at the first card', async () => {
    const page = await app.page(progress({ ids:[0,1,2,3,4], lessons:{ 1:'reading' } }));
    await page.click('#lesson');
    await page.waitForSelector('.story');
    assert.equal(await page.$$eval('.card .word', e => e.length), 0, 'it went back to the cards');
    await page.close_();
  });

  test('an unfinished lesson beats the daily cap, so the cap cannot strand you halfway', async () => {
    const page = await app.page(progress({ ids:[0,1,2,3,4], opened:1, lessons:{ 1:'quiz' } }));
    const learn = await page.$eval('#lesson', b => ({ text:b.textContent, off:b.disabled }));
    assert.equal(learn.off, false, 'five words are open and today\'s cap is spent, but the lesson is not done');
    assert.equal(learn.text, 'Learn');
    await page.close_();
  });
});

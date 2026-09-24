/* The home screen, and the interface rules that hold across every screen.
 *
 * CLAUDE.md's interface rules are not decoration - each one is there because
 * the opposite shipped once and was wrong on a real phone. They are checked
 * in a real browser because that is the only place "which button is filled"
 * and "is anything shouting at low opacity" actually mean anything.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, browserSkip } from '../helpers/browser.mjs';
import { progress, afterFirstLesson, daysAgo } from '../helpers/seed.mjs';

describe('home', { skip: browserSkip ?? false, concurrency: 1 }, () => {
  let app;
  before(async () => { app = await openApp(); });
  after(async () => { await app.close(); });

  /** Every button the learner can see, with what it looks like. */
  const buttons = page => page.$$eval('#screen button', bs => bs.map(b => ({
    id: b.id, text: b.textContent.trim(), cls: b.className, off: b.disabled
  })));

  test('a fresh install boots to the gauge and one thing to do', async () => {
    const page = await app.page();
    assert.equal(await page.textContent('.gnum'), '0%');
    assert.match(await page.textContent('.key'), /Learned\s*0/);

    const bs = await buttons(page);
    assert.deepEqual(bs.map(b => b.id), ['lesson','reading','list','settings']);
    assert.equal(bs.find(b => b.id === 'lesson').text, 'Learn');
    assert.deepEqual(page.errors, []);
    assert.deepEqual(page.logged, [],
      'a stylesheet, module or recording that 404s shows up here and nowhere else');
    await page.close_();
  });

  test('exactly one button is filled, and it is one that can be pressed', async () => {
    for(const state of [null, afterFirstLesson(), progress({ ids:[0,1,2], next: daysAgo(1) })]){
      const page = await app.page(state);
      const bs = await buttons(page);
      const filled = bs.filter(b => b.cls.split(' ').includes('go') && !b.cls.includes('ghost'));
      assert.equal(filled.length, 1, `expected one filled button, got ${filled.map(b=>b.id)}`);
      assert.equal(filled[0].off, false, `the filled button "${filled[0].id}" is disabled`);
      await page.close_();
    }
  });

  test('a disabled control leaves the hierarchy instead of shouting', async () => {
    const page = await app.page(afterFirstLesson());
    for(const b of (await buttons(page)).filter(b => b.off)){
      assert.match(b.cls, /ghost/, `the disabled "${b.id}" is still styled as an action`);
    }
    await page.close_();
  });

  test('with words due, review leads and says how many', async () => {
    const page = await app.page(progress({ ids:[0,1,2], next: daysAgo(1) }));
    const review = (await buttons(page)).find(b => b.id === 'review');
    assert.equal(review.text, 'Review 3 words');
    assert.ok(!review.cls.includes('ghost'), 'the thing to do now is the filled one');
    await page.close_();
  });

  test('one word due reads as one word, not "1 words"', async () => {
    const page = await app.page(progress({ ids:[0], next: daysAgo(1) }));
    assert.equal((await buttons(page)).find(b => b.id === 'review').text, 'Review 1 word');
    await page.close_();
  });

  test('with the daily cap spent, Learn says when it comes back rather than going quiet', async () => {
    const page = await app.page(afterFirstLesson({ opened: 1 }));
    const learn = (await buttons(page)).find(b => b.id === 'lesson');
    assert.match(learn.text, /New words in \d+h \d+m/);
    assert.equal(learn.off, true);
    await page.close_();
  });

  test('the gauge counts the whole journey, not just the finish', async () => {
    const page = await app.page(progress({ ids:[0,1,2,3,4] }));
    assert.equal(await page.textContent('.gnum'), '2%', 'five words opened is 5/3 of a percent, rounded');
    assert.match(await page.textContent('.key'), /Started\s*5/);
    await page.close_();
  });

  test('the word list is rows with hairlines, not a hundred bordered cards', async () => {
    const page = await app.page(progress({ ids:[0,1,2] }));
    await page.click('#list');
    await page.waitForSelector('.list .item');
    assert.equal(await page.$$eval('.list .item', e => e.length), 3);
    assert.equal(await page.$$eval('.list .card', e => e.length), 0,
      'a bordered card inside the list would be a border the eye has to cross');
    assert.match(await page.textContent('.list .item'), /shallow/);
    await page.close_();
  });

  test('an empty word list says what to do about it', async () => {
    const page = await app.page();
    await page.click('#list');
    await page.waitForSelector('.card.muted');
    assert.match(await page.textContent('.card.muted'), /Open your first lesson/);
    await page.close_();
  });

  test('back is a chevron in the header, never a button in the stack', async () => {
    const page = await app.page(progress({ ids:[0,1,2] }));
    for(const screen of ['#list','#settings']){
      await page.click(screen);
      await page.waitForSelector('.pagehead');
      assert.equal(await page.$$eval('.pagehead .backlink', e => e.length), 1);
      assert.equal(await page.$$eval('#screen button.go[data-back]', e => e.length), 0,
        'back is navigation, not one of the things you came here to do');
      await page.click('.backlink');
      await page.waitForSelector('.gauge');
    }
    await page.close_();
  });

  test('nothing in the flow asks for typing', async () => {
    const page = await app.page(progress({ ids:[0,1,2] }));
    for(const screen of ['#list','#settings','#reading']){
      await page.click(screen);
      await page.waitForSelector('#screen > *');
      assert.equal(await page.$$eval('input, textarea, select', e => e.length), 0,
        `${screen} asks the learner to type something`);
      await page.click('.backlink');
      await page.waitForSelector('.gauge');
    }
    assert.deepEqual(page.errors, []);
    await page.close_();
  });
  /* Twelve words still in box 0, due now, and lesson 3 not yet opened. */
  const backlog = (n = 12) => {
    const ids = Array.from({ length:n }, (_, i) => i);
    return progress({ ids, next: daysAgo(1), opened: 24, lessons:{ 1:'done', 2:'done' } });
  };

  test('with more than ten words on day one, a new lesson asks "review first?" and still lets you in',
    async () => {
      const page = await app.page(backlog());
      assert.match(await page.textContent('#screen'), /12 words are still on their first step/);
      await page.click('#lesson');
      await page.waitForSelector('.pagehead h1');
      assert.equal(await page.textContent('.pagehead h1'), 'Review first?');
      const bs = await buttons(page);
      const filled = bs.filter(b => b.cls === 'go');
      assert.deepEqual(filled.map(b => b.id), ['review'], 'the review is the recommendation');
      assert.ok(bs.find(b => b.id === 'anyway' && b.cls.includes('ghost')), 'the lesson stays one tap away');

      await page.click('#anyway');
      await page.waitForSelector('.card .word');
      assert.equal(await page.textContent('.pill'), 'New word 1 of 5');
      assert.deepEqual(page.errors, []);
      await page.close_();
    });

  test('"Review first" on that prompt starts a review sitting', async () => {
    const page = await app.page(backlog());
    await page.click('#lesson');
    await page.waitForSelector('#review');
    await page.click('#review');
    await page.waitForSelector('#show');
    assert.match(await page.textContent('.pill'), /^Done 0 of 7$/);
    await page.close_();
  });

  test('ten or fewer on day one: Learn goes straight to the lesson', async () => {
    const page = await app.page(backlog(10));
    assert.doesNotMatch(await page.textContent('#screen'), /first step/);
    await page.click('#lesson');
    await page.waitForSelector('.card .word');
    await page.close_();
  });
});

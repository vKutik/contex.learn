/* The quiz runner, driven in a real browser with questions of our own.
 *
 * Every quiz in the app - the recall stage, the lesson's comprehension
 * questions and the reading check - goes through runQuiz, so its feedback
 * contract is the one piece of interface behaviour worth testing directly
 * rather than through a screen. Rule 9 lives here: a miss must never flash
 * red, it dims the tap, lifts the right answer and says what the word means.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, browserSkip } from '../helpers/browser.mjs';

describe('the quiz runner', { skip: browserSkip ?? false, concurrency: 1 }, () => {
  let app, page;

  before(async () => {
    app = await openApp();
    page = await app.page(null, { path: '/tests/e2e/harness.html' });
  });
  after(async () => { await app.close(); });

  /** Mount a quiz of our own making and return handles to what it reports. */
  const mount = questions => page.evaluate(async qs => {
    const { runQuiz } = await import('/js/components/quiz.js');
    window.seen = [];
    window.done = null;
    document.querySelector('#stage').innerHTML = '';
    runQuiz(document.querySelector('#stage'), qs, {
      onAnswer: (q, ok) => window.seen.push({ wordId:q.wordId, ok }),
      onDone: (score, total) => { window.done = { score, total }; }
    });
  }, questions);

  const GAP = {
    kind:'gap', wordId:1, prompt:'The water was <u> </u> here.',
    options:['shallow','stubborn','ancient'], correctIndex:0,
    explain:'<b>shallow</b> — not deep'
  };
  const FOCUS = {
    kind:'focus', wordId:2, prompt:'Her hands <mark>trembled</mark>.',
    claim:'to shake slightly', options:['Yes, it fits','No, it does not'],
    correctIndex:0, explain:'<b>tremble</b> — to shake slightly'
  };

  const classesOf = () => page.$$eval('[data-k]', bs => bs.map(b => b.className));
  const textsOf   = () => page.$$eval('[data-k]', bs => bs.map(b => b.textContent));
  const clickText = async label => {
    const i = (await textsOf()).indexOf(label);
    assert.ok(i >= 0, `no option reads "${label}"`);
    await page.click(`[data-k="${i}"]`);
  };

  test('it counts the questions and renders one tap per option', async () => {
    await mount([GAP, FOCUS]);
    await page.waitForSelector('[data-k]');
    assert.equal(await page.textContent('.pill'), 'Question 1 of 2');
    assert.equal((await classesOf()).length, 3);
    assert.equal(await page.$$eval('input, select, textarea', e => e.length), 0,
      'one tap is the answer: no radio buttons, no text fields, no submit');
  });

  test('the explanation is hidden until something is answered', async () => {
    await mount([GAP]);
    await page.waitForSelector('[data-k]');
    assert.equal(await page.$eval('.explain', e => e.hidden), true);
  });

  test('a right answer lifts and says why', async () => {
    await mount([GAP]);
    await page.waitForSelector('[data-k]');
    await clickText('shallow');
    await page.waitForSelector('.is-right');

    const classes = await classesOf();
    assert.equal(classes.filter(c => c.includes('is-right')).length, 1);
    assert.equal(classes.filter(c => c.includes('is-dim')).length, 0,
      'nothing is dimmed when the answer was right');
    assert.equal(await page.$eval('.explain', e => e.hidden), false);
    assert.match(await page.textContent('.explain'), /not deep/);
  });

  test('a miss dims the tap, lifts the answer, and never flashes red', async () => {
    await mount([GAP]);
    await page.waitForSelector('[data-k]');
    await clickText('stubborn');
    await page.waitForSelector('.is-reveal');

    const state = await page.$$eval('[data-k]', bs =>
      bs.map(b => ({ text:b.textContent, cls:b.className })));
    const tapped  = state.find(s => s.text === 'stubborn');
    const correct = state.find(s => s.text === 'shallow');

    assert.match(tapped.cls, /is-dim/, 'the miss steps back');
    assert.doesNotMatch(tapped.cls, /is-right/);
    assert.match(correct.cls, /is-reveal/, 'the right answer steps forward');
    for(const s of state){
      assert.doesNotMatch(s.cls, /wrong|error|danger|red/,
        'feedback is never punitive - there is no red anywhere in it');
    }
    assert.match(await page.textContent('.explain'), /not deep/,
      'a miss must say what the word actually means');
  });

  test('it reports every answer to the screen that owns the score', async () => {
    await mount([GAP, FOCUS]);
    await page.waitForSelector('[data-k]');
    await clickText('shallow');
    await page.waitForSelector('.is-right');
    await page.waitForTimeout(1300);                       // the runner advances itself
    await page.waitForSelector('.claim');
    await clickText('No, it does not');
    await page.waitForSelector('.is-reveal');
    await page.waitForTimeout(3000);

    assert.deepEqual(await page.evaluate(() => window.seen),
      [{ wordId:1, ok:true }, { wordId:2, ok:false }]);
    assert.deepEqual(await page.evaluate(() => window.done), { score:1, total:2 });
  });

  test('leaving mid-feedback does not finish the quiz behind the learner\'s back', async () => {
    // the back chevron swaps the screen while the answer is still showing;
    // the pending auto-advance must not report a score nobody saw, or the
    // screen that owns it would save the result and paint over wherever the
    // learner went
    await mount([GAP]);
    await page.waitForSelector('[data-k]');
    await clickText('shallow');
    await page.waitForSelector('.is-right');
    await page.evaluate(() => {
      const old = document.querySelector('#stage');
      old.replaceWith(old.cloneNode(false));             // what go() does to it
    });
    await page.waitForTimeout(1300);                       // past the auto-advance
    assert.equal(await page.evaluate(() => window.done), null);
  });

  test('yes and no keep their order; a row of pills does not', async () => {
    for(let run = 0; run < 4; run++){
      await mount([FOCUS]);
      await page.waitForSelector('[data-k]');
      assert.deepEqual(await textsOf(), ['Yes, it fits','No, it does not']);
    }
    const orders = new Set();
    for(let run = 0; run < 25; run++){
      await mount([GAP]);
      await page.waitForSelector('[data-k]');
      orders.add((await textsOf()).join('|'));
    }
    assert.ok(orders.size > 1, 'the options came back in the same order 25 times');
  });

  test('a lesson question, which arrives without a kind, still runs', async () => {
    await mount([{ question:'The water was shallow. That means it was',
                   options:['not deep','not clean'], correctIndex:0 }]);
    await page.waitForSelector('.optlist .opt');
    assert.match(await page.textContent('.qcard'), /The water was shallow/);
    await clickText('not deep');
    await page.waitForSelector('.is-right');
    assert.equal(await page.$eval('.explain', e => e.hidden), true,
      'a comprehension question has nothing to explain, so the line stays away');
  });

  test('the page logged no errors while all that happened', () => {
    assert.deepEqual(page.errors, []);
  });
});

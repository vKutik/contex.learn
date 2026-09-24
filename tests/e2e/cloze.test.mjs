/* Cloze cards as a learner meets them.
 *
 * The recall stage and the review screen now ask the word in a hand-written
 * sentence, a different one each time, and a miss says why the word tapped
 * does not belong. Typing the answer is a setting, off by default, and a typed
 * synonym is neither right nor wrong.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, browserSkip, answer, savedProgress } from '../helpers/browser.mjs';
import { progress, daysAgo } from '../helpers/seed.mjs';
import { cloze } from '../../js/data/cloze.js';

/** What a learner reads for a card: the blank drawn as a gap. */
const shown = card => card.s.replace('____', ' ').replace(/\s+/g, ' ').trim();
const text = async (page, sel) => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();

describe('cloze cards', { skip: browserSkip ?? false, concurrency: 1 }, () => {
  let app;
  before(async () => { app = await openApp(); });
  after(async () => { await app.close(); });

  test('recall asks each word in its defining sentence, and remembers which card was met', async () => {
    const page = await app.page(progress({ ids:[0,1,2,3,4], lessons:{ 1:'recall' } }));
    await page.click('#lesson');
    const asked = [];
    for(let i = 0; i < 5; i++){
      await page.waitForSelector('.cloze');
      asked.push(await text(page, '.cloze'));
      await answer(page, 0);
    }
    await page.waitForSelector('.story');

    const defining = [0,1,2,3,4].map(id => cloze[id].find(c => c.t === 'df'));
    assert.deepEqual(asked.slice().sort(), defining.map(shown).sort(),
      'the first meeting in a sentence is the one that explains the word');

    const saved = await savedProgress(page);
    for(const c of defining){
      const wordId = c.id.split(':')[0];
      assert.deepEqual(saved.clozeSeen[wordId], [c.id]);
      assert.equal(saved.clozeStats[c.id].shown, 1);
    }
    await page.close_();
  });

  test('progress saved before cloze cards existed still loads and starts remembering', async () => {
    const old = progress({ ids:[0,1,2,3,4], lessons:{ 1:'recall' } });
    delete old.clozeSeen; delete old.clozeStats;
    const page = await app.page(old);
    await page.click('#lesson');
    await answer(page, 0);
    const saved = await savedProgress(page);
    assert.equal(Object.keys(saved.clozeSeen).length, 1);
    assert.equal(Object.keys(saved.words).length, 5, 'nothing that was there is lost');
    assert.deepEqual(page.errors, []);
    await page.close_();
  });

  test('review asks a card not met yet, shows it filled in, and counts the grade', async () => {
    // shallow has met its defining card (0:3) in the lesson; seen:0 asks a gap
    const page = await app.page(progress({ ids:[0], next: daysAgo(1), clozeSeen:{ 0:['0:3'] } }));
    await page.click('#review');
    await page.waitForSelector('#show');
    const next = cloze[0].find(c => c.t === 'cq');
    assert.equal(await text(page, '.cloze'), shown(next), 'the next anchor in order, not the one already met');

    await page.click('#show');
    await page.waitForSelector('.grade');
    assert.equal(await text(page, '.card .cloze mark'), next.a, 'the reveal writes the word back in');
    await page.click('[data-g="2"]');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('vocab-progress')).clozeSeen[0].length === 2);

    const saved = await savedProgress(page);
    assert.deepEqual(saved.clozeSeen[0], ['0:3', next.id]);
    assert.deepEqual(saved.clozeStats[next.id], { shown:1, correct:1, wrong:0, synonym:0 });
    await page.close_();
  });

  /* ---------- the runner, with real cards ---------- */

  /** Mount one card of the real data as a question; returns what it reported. */
  const mount = (page, cardId, options) => page.evaluate(async ({ cardId, options }) => {
    const { runQuiz } = await import('/js/components/quiz.js');
    const { cloze } = await import('/js/data/cloze.js');
    const { words } = await import('/js/data/words.js');
    const [wordId, n] = cardId.split(':').map(Number);
    const c = cloze[wordId][n];
    window.seen = []; window.done = null;
    runQuiz(document.querySelector('#stage'), [{
      kind:'gap', wordId, cardId, prompt: c.s.replace('____', '<u> </u>'),
      options, correctIndex:0, answer:c.a, alt:c.alt, why:c.why,
      filled: c.s.replace('____', `<mark>${c.a}</mark>`),
      explain:`<b>${c.a}</b> — ${words[wordId].definition}`
    }], {
      onAnswer: (q, ok, outcome) => window.seen.push({ ok, outcome }),
      onDone: (score, total, extra) => { window.done = { score, total, ...extra }; }
    });
  }, { cardId, options });

  const harness = settings => app.page(null, { path:'/tests/e2e/harness.html', settings });
  const clickPill = async (page, label) => {
    const labels = await page.$$eval('[data-k]', bs => bs.map(b => b.textContent));
    await page.click(`[data-k="${labels.indexOf(label)}"]`);
    await page.waitForSelector('.explain:not([hidden])');
  };

  test('a wrong pill the card was written against says why it does not belong', async () => {
    const page = await harness();
    // "My aunt listens and changes her plans, but my uncle is completely ____."
    await mount(page, '1:2', ['stubborn', 'rude', 'anxious', 'eager']);
    await clickPill(page, 'rude');
    const note = await text(page, '.explain');
    assert.match(note, /my uncle is completely stubborn/, 'the whole sentence, with the word in it');
    assert.match(note, /refusing to change your mind/, 'what the word means');
    assert.match(note, /rude — rudeness is about manners/, 'why the tapped word is wrong');
    assert.equal(await page.$$eval('.is-reveal', e => e.length), 1, 'the answer lifts in amber');
    assert.equal(await page.$$eval('.is-right', e => e.length), 0);
    await page.close_();
  });

  test('a wrong pill with no reason written still gets the sentence and the meaning', async () => {
    const page = await harness();
    await mount(page, '1:2', ['stubborn', 'rude', 'anxious', 'eager']);
    await clickPill(page, 'anxious');
    const note = await text(page, '.explain');
    assert.match(note, /completely stubborn/);
    assert.doesNotMatch(note, /anxious —/);
    await page.close_();
  });

  test('pills are the default: no text field anywhere', async () => {
    const page = await harness();
    await mount(page, '1:2', ['stubborn', 'rude', 'anxious', 'eager']);
    await page.waitForSelector('[data-k]');
    assert.equal(await page.$$eval('input', e => e.length), 0);
    await page.close_();
  });

  /* ---------- typing, when the learner asked for it ---------- */

  const type = async (page, word) => {
    await page.waitForSelector('.typein');
    await page.fill('.typein', word);
    await page.press('.typein', 'Enter');
    await page.waitForSelector('.explain:not([hidden])');
  };

  test('typed: the answer is right whatever its case and punctuation', async () => {
    const page = await harness({ typeCloze:true });
    await mount(page, '1:2', ['stubborn']);
    await type(page, '  Stubborn! ');
    assert.deepEqual(await page.evaluate(() => window.seen), [{ ok:true, outcome:'correct' }]);
    assert.ok(await page.$('.typein.is-right'));
    await page.close_();
  });

  test('typed: a word the card also accepts is neither a miss nor a hit', async () => {
    const page = await harness({ typeCloze:true });
    // "That old, ____ stain won't come out" also takes "tough"
    await mount(page, '1:4', ['stubborn']);
    await type(page, 'tough');
    assert.match(await text(page, '.explain'), /Also fits: tough\. The target word is: stubborn\./);
    assert.deepEqual(await page.evaluate(() => window.seen), [{ ok:false, outcome:'synonym' }]);
    await page.click('#stage', { position:{ x:4, y:4 }, force:true, delay:400 }).catch(() => {});
    await page.waitForFunction(() => window.done);
    assert.deepEqual(await page.evaluate(() => window.done), { score:0, total:1, synonyms:1 });
    const stats = await page.evaluate(() => JSON.parse(localStorage.getItem('vocab-progress')).clozeStats);
    assert.deepEqual(stats['1:4'], { shown:1, correct:0, wrong:0, synonym:1 });
    await page.close_();
  });

  test('typed: a rejected word gets its reason', async () => {
    const page = await harness({ typeCloze:true });
    await mount(page, '0:0', ['shallow']);
    await type(page, 'small');
    assert.match(await text(page, '.explain'), /small — a small lake can still be deep/);
    assert.deepEqual(await page.evaluate(() => window.seen), [{ ok:false, outcome:'wrong' }]);
    await page.close_();
  });

  test('typing is switched on in Settings, and off again', async () => {
    const page = await app.page(progress({ ids:[0] }));
    await page.click('#settings');
    await page.waitForSelector('#typing');
    assert.equal(await text(page, '#typing'), 'Type answers instead');
    await page.click('#typing');
    await page.waitForFunction(() => document.querySelector('#typing')?.textContent === 'Go back to tapping');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('vocab-settings')).typeCloze), true);
    await page.click('#typing');
    await page.waitForFunction(() => document.querySelector('#typing')?.textContent === 'Type answers instead');
    await page.close_();
  });

  test('the developer card lists the most-missed cards', async () => {
    const state = progress({ ids:[0] });
    state.clozeStats = { '0:0': { shown:4, correct:1, wrong:3, synonym:0 },
                         '0:1': { shown:2, correct:0, wrong:2, synonym:0 } };
    const page = await app.page(state, { settings:{ devMode:true } });
    await page.click('#settings');
    await page.waitForSelector('.item');
    const rows = await page.$$eval('.item', r => r.map(x => x.textContent.replace(/\s+/g, ' ')));
    assert.equal(rows.length, 1, 'a card shown twice is too few to judge');
    assert.match(rows[0], /75% missed/);
    assert.match(rows[0], /The lake was so/);
    await page.close_();
  });
});

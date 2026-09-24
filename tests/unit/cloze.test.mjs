/* Cloze cards: which one is asked, and what sits beside it.
 *
 * The whole point of five cards a word is that the learner meets the word in
 * a different sentence each time and never in the one they just read. The
 * pills are the other half: a wrong pill that also fits the sentence, or one
 * that is the answer with a different ending, marks a right answer wrong or
 * gives it away. Both are checked over every card of every word.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pickCloze, gapQuestion } from '../../js/components/quiz.js';
import { clozeFor } from '../../js/data.js';
import { words } from '../../js/data/words.js';
import * as store from '../../js/storage.js';
import * as srs from '../../js/srs.js';
import { fresh, seedWord } from '../helpers/fixture.mjs';

beforeEach(fresh);

const DRAWS = 8;
const plain = s => s.toLowerCase().replace(/[{}]/g, '').replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const filled = c => plain(c.s.replace('____', c.a));

/* ---------- which card ---------- */

test('pickCloze never hands back the sentence the learner has just read', () => {
  for(const w of words){
    // the card's own examples, as the flashcard shows them
    for(const ex of w.examples){
      const card = pickCloze(w.id, { avoidSentence: ex });
      if(!card) continue;
      const a = filled(card), b = plain(ex);
      assert.ok(!a.includes(b) && !b.includes(a), `${w.word}: "${card.s}" is "${ex}" again`);
    }
    // and a cloze sentence itself
    for(const c of clozeFor(w.id)){
      const card = pickCloze(w.id, { avoidSentence: c.s.replace('____', c.a) });
      assert.notEqual(card && card.id, c.id, `${w.word}: asked ${c.id} straight back`);
    }
  }
});

test('five answers in a row meet five different cards, then the oldest comes back', async () => {
  for(const w of words){
    await fresh();
    const met = [];
    for(let n = 0; n < 5; n++){
      const card = pickCloze(w.id);
      met.push(card.id);
      await store.markClozeSeen(w.id, card.id);
    }
    assert.equal(new Set(met).size, 5, `${w.word}: ${met}`);
    assert.equal(pickCloze(w.id).id, met[0], `${w.word}: the card met longest ago is next`);
  }
});

test('first meetings go definition, consequence, cause, contrast, collocation', async () => {
  const order = [];
  for(let n = 0; n < 5; n++){
    const card = pickCloze(0);
    order.push(card.t);
    await store.markClozeSeen(0, card.id);
  }
  assert.deepEqual(order, ['df', 'cq', 'ca', 'ct', 'cl']);
});

test('a word with no cards gives no card rather than throwing', () => {
  assert.equal(pickCloze(900), null);
  assert.equal(pickCloze(900, { avoidSentence: 'Anything at {all}.' }), null);
});

test('the recall stage avoids the flashcard sentence even when a card grew out of it', () => {
  // "Dig a {shallow} trench for the cable." is card 0:3's sentence, cut short
  const avoid = words[0].examples.find(e => /trench/.test(e));
  assert.ok(avoid, 'the fixture sentence is still an example of shallow');
  for(let n = 0; n < 5; n++){
    const card = pickCloze(0, { avoidSentence: avoid });
    assert.doesNotMatch(card.s, /trench/);
    store.markClozeSeen(0, card.id);
  }
});

/* ---------- what sits beside it ---------- */

/** Every card of every word, asked DRAWS times. */
async function everyCard(fn){
  for(const w of words){
    await fresh();
    for(const _ of clozeFor(w.id)){
      let q;
      for(let n = 0; n < DRAWS; n++){ q = gapQuestion(w, words); fn(w, q, clozeFor(w.id).find(c => c.id === q.cardId)); }
      await store.markClozeSeen(w.id, q.cardId);
    }
  }
}

test('no wrong pill is a word the card says also fits', async () => {
  const byWord = Object.fromEntries(words.map(w => [w.word, w]));
  await everyCard((w, q, card) => {
    for(const opt of q.options.filter((_, k) => k !== q.correctIndex)){
      assert.ok(!card.alt.includes(opt.toLowerCase()),
        `${card.id}: "${opt}" also fits "${card.s}" and would be marked wrong`);
    }
  });
  // the pairs the data actually has: crack <-> gap, crew -> shift, eager -> anxious ...
  const seen = new Set();
  await everyCard((w, q, card) => {
    for(const a of card.alt) if(byWord[a]) seen.add(`${w.word}>${a}`);
  });
  assert.ok(seen.size >= 5, 'the check never met a course word in `alt`, so it proved little');
});

test('no wrong pill shares a root with the answer or is its close neighbour', async () => {
  // the pairs named when the rule was written, plus the ones a learner would
  // most plausibly argue for
  const NEAR = [['shelf','shelter'], ['tight','strict'], ['crack','gap'], ['realise','notice'],
                ['gradually','eventually'], ['rarely','barely'], ['reward','wage']];
  await everyCard((w, q) => {
    const answerWord = w.word;
    for(const opt of q.options.filter((_, k) => k !== q.correctIndex).map(o => o.toLowerCase())){
      for(const [a, b] of NEAR){
        const partner = answerWord === a ? b : answerWord === b ? a : null;
        assert.ok(!partner || !opt.startsWith(partner.slice(0, -1)),
          `${answerWord}: "${opt}" is its neighbour ${partner}`);
      }
      assert.notEqual(opt.slice(0, 5), answerWord.slice(0, 5), `${answerWord}: "${opt}" looks like the same word`);
    }
  });
});

test('every wrong pill is the same part of speech as the answer', async () => {
  await everyCard((w, q) => {
    const others = words.filter(o => o.pos !== w.pos).map(o => o.word);
    for(const opt of q.options.filter((_, k) => k !== q.correctIndex)){
      assert.ok(!others.includes(opt.toLowerCase()), `${w.word} (${w.pos}): "${opt}" is another class`);
    }
  });
});

test('a card question carries what a miss needs to explain itself', async () => {
  await everyCard((w, q, card) => {
    assert.equal(q.answer, card.a);
    assert.match(q.filled, new RegExp(`<mark>${card.a}</mark>`));
    assert.doesNotMatch(q.filled, /____/);
    assert.deepEqual(q.why, card.why);
    assert.ok(q.explain.includes(w.definition));
  });
});

/* ---------- what is remembered ---------- */

test('only the last five cards met are remembered, oldest first, without repeats', async () => {
  for(const id of ['0:0','0:1','0:2','0:1','0:3','0:4','0:0']) await store.markClozeSeen(0, id);
  assert.deepEqual(store.clozeSeen(0), ['0:2','0:1','0:3','0:4','0:0']);
  assert.deepEqual(store.clozeSeen(1), [], 'another word has met nothing');
});

test('every answer counts as one showing, split by how it went', async () => {
  await store.countCloze('3:1', 'correct');
  await store.countCloze('3:1', 'wrong');
  await store.countCloze('3:1', 'synonym');
  assert.deepEqual(store.clozeStats()['3:1'], { shown:3, correct:1, wrong:1, synonym:1 });
});

test('worstCards lists the most-missed cards first, and only those shown three times', async () => {
  const answer = async (id, outcomes) => { for(const o of outcomes) await store.countCloze(id, o); };
  await answer('5:0', ['wrong','wrong','correct']);           // 2/3
  await answer('5:1', ['wrong','correct','correct','correct']); // 1/4
  await answer('5:2', ['wrong','wrong']);                     // shown twice: too few to judge
  const worst = srs.worstCards();
  assert.deepEqual(worst.map(c => c.id), ['5:0','5:1']);
  assert.equal(worst[0].card.id, '5:0', 'the card itself comes along, so it can be read');
  assert.ok(Math.abs(worst[0].rate - 2/3) < 1e-9);
});

test('a tricky word\'s gap fill uses an unseen card, then the worst - never the one just met', async () => {
  await seedWord(0, { wrong:6, box:1 });
  const ids = clozeFor(0).map(c => c.id);
  for(const id of ids.slice(0, 3)) await store.markClozeSeen(0, id);
  assert.ok(!ids.slice(0, 3).includes(pickCloze(0).id), 'an unseen card while one is left');

  for(const id of ids) await store.markClozeSeen(0, id);   // all met, ids.at(-1) last
  await store.countCloze(ids[1], 'wrong');                  // 1 of 1 missed
  await store.countCloze(ids.at(-1), 'wrong');              // just as bad, but met last
  await store.countCloze(ids.at(-1), 'wrong');
  assert.equal(pickCloze(0).id, ids[1]);

  await seedWord(0, { wrong:6, box:3 });                    // no longer tricky: the usual rule
  assert.equal(pickCloze(0).id, ids[0], 'the card met longest ago');
});

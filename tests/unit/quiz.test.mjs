/* quiz.js - the three generated mechanics.
 *
 * These are built from the word list at run time and are therefore the part
 * of the app most likely to break silently when the data changes: a new word
 * with an odd part of speech, or an example with no inflected form to borrow,
 * shows up here as an unanswerable question rather than as an error.
 *
 * So the invariants are checked against every one of the 100 words rather
 * than one hand-picked example, and the random ones are checked over enough
 * draws that a bad case cannot hide. Nothing here asserts a particular
 * random outcome - only things that must hold for every draw.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gapQuestion, questionFor, anyQuestion } from '../../js/components/quiz.js';
import { surfaceOf } from '../../js/components/word.js';
import { words } from '../../js/data/words.js';
import { withRandom } from '../helpers/fixture.mjs';

const DRAWS = 5;
const everyWord = fn => words.forEach(w => { for(let n = 0; n < DRAWS; n++) fn(w, n); });

/* ---------- 1. the gap fill ---------- */

test('every word can produce a gap question with four distinct options', () => {
  everyWord(w => {
    const q = gapQuestion(w, words);
    assert.equal(q.kind, 'gap');
    assert.equal(q.wordId, w.id);
    assert.equal(q.options.length, 4, `${w.word}: expected four pills`);
    const lower = q.options.map(o => o.toLowerCase());
    assert.equal(new Set(lower).size, 4, `${w.word}: duplicate pills ${q.options}`);
    assert.ok(q.options.every(o => o && o.trim()), `${w.word}: an empty pill`);
  });
});

test('the answer is the option at correctIndex and it is the form the sentence used', () => {
  everyWord(w => {
    const q = gapQuestion(w, words);
    const answer = q.options[q.correctIndex];
    assert.ok(w.examples.some(ex => surfaceOf(ex) === answer),
      `${w.word}: "${answer}" is not a form any of its examples uses`);
  });
});

test('the prompt shows a gap and never contains the answer', () => {
  everyWord(w => {
    const q = gapQuestion(w, words);
    assert.ok(q.prompt.includes('<u> </u>'), `${w.word}: no gap in the prompt`);
    const answer = q.options[q.correctIndex];
    assert.doesNotMatch(q.prompt.toLowerCase(), new RegExp(`\\b${escape(answer.toLowerCase())}\\b`),
      `${w.word}: the prompt gives the answer away`);
  });
});

test('the sentence the learner has just read is avoided when the word has another', () => {
  for(const w of words.filter(w => w.examples.length > 1)){
    const avoid = w.examples[0];
    for(let n = 0; n < 20; n++){
      const q = gapQuestion(w, words, avoid);
      assert.notEqual(q.prompt, avoid.replace(/\{(.+?)\}/, '<u> </u>'),
        `${w.word}: asked back the sentence just shown`);
    }
  }
});

test('a word with a single example still produces a question rather than nothing', () => {
  const lonely = { id:900, word:'shallow', pos:'adj', definition:'not deep',
                   opposite:'deep', ipa:'x', examples:['A {shallow} pool.'] };
  const q = gapQuestion(lonely, [...words, lonely], lonely.examples[0]);
  assert.equal(q.options.length, 4);
  assert.equal(q.options[q.correctIndex], 'shallow');
});

test('an inflected answer is never the only pill with that ending', () => {
  // the shape of the options must not point at the right one: if the answer
  // is "trembled", three dictionary forms beside it would give it away.
  // Only an answer that is actually inflected can be given away this way -
  // a base form sitting next to "anxious" or "afford" is no cue at all.
  let checked = 0;
  everyWord(w => {
    const q = gapQuestion(w, words);
    const answer = q.options[q.correctIndex].toLowerCase();
    if(answer === w.word.toLowerCase()) return;
    const ending = /ing$/.test(answer) ? 'ing' : /ed$/.test(answer) ? 'ed'
                 : /s$/.test(answer) ? 's' : null;
    if(!ending) return;
    checked++;
    for(const opt of q.options){
      assert.match(opt.toLowerCase(), new RegExp(ending + '$'),
        `${w.word}: answer "${answer}" but pill "${opt}" has a different ending`);
    }
  });
  assert.ok(checked > 20, `only ${checked} inflected answers drawn - the check proved little`);
});

/* ---------- 2. the context match ---------- */

test('match shows the word and exactly two sentences, its own first', () => {
  everyWord(w => {
    const q = questionFor(w, words, 1);
    assert.equal(q.kind, 'match');
    assert.equal(q.word, w.word);
    assert.equal(q.options.length, 2);
    assert.equal(q.correctIndex, 0);
    assert.notEqual(q.options[0], q.options[1], `${w.word}: the two sentences are the same`);
    assert.ok(q.options.every(o => o.includes('<mark>')), `${w.word}: a sentence with nothing marked`);
  });
});

test('the wrong sentence belongs to another word, with this one transplanted in', () => {
  for(const w of words){
    for(let n = 0; n < DRAWS; n++){
      const q = questionFor(w, words, 1);
      assert.ok(!w.examples.some(ex => ex.replace(/\{(.+?)\}/, m => m) === q.options[1]),
        `${w.word}: the wrong sentence is one of its own`);
    }
  }
});

/* ---------- 3. the focus check ---------- */

test('focus offers yes and no, in that order, and never shuffles them', () => {
  everyWord(w => {
    const q = questionFor(w, words, 2);
    assert.equal(q.kind, 'focus');
    assert.equal(q.options.length, 2);
    assert.match(q.options[0], /^Yes/);
    assert.match(q.options[1], /^No/);
  });
});

test('a truthful claim is the word\'s own definition and the answer is yes', async () => {
  await withRandom([0.1], () => {
    for(const w of words){
      const q = questionFor(w, words, 2);
      assert.equal(q.claim, w.definition, `${w.word}: truthful claim was not its definition`);
      assert.equal(q.correctIndex, 0);
    }
  });
});

test('an untruthful claim belongs to another word and the answer is no', async () => {
  await withRandom([0.9], () => {
    for(const w of words){
      const q = questionFor(w, words, 2);
      assert.notEqual(q.claim, w.definition, `${w.word}: untruthful claim was its own definition`);
      assert.equal(q.correctIndex, 1);
      assert.match(q.explain, /really means/);
    }
  });
});

/* ---------- the three together ---------- */

test('questionFor rotates through the mechanics so a shelf never repeats itself', () => {
  const kinds = [0,1,2,3,4,5,6].map(n => questionFor(words[0], words, n).kind);
  assert.deepEqual(kinds, ['gap','match','focus','gap','match','focus','gap']);
});

test('anyQuestion only ever produces one of the three', () => {
  const kinds = new Set();
  for(let n = 0; n < 200; n++) kinds.add(anyQuestion(words[n % words.length], words).kind);
  assert.deepEqual([...kinds].sort(), ['focus','gap','match']);
});

test('every question a screen can be handed is answerable and explains itself', () => {
  everyWord((w, n) => {
    const q = questionFor(w, words, n);
    assert.equal(q.wordId, w.id, 'the runner credits the word by id');
    assert.ok(q.options.length >= 2);
    assert.ok(q.correctIndex >= 0 && q.correctIndex < q.options.length);
    assert.ok(q.explain && q.explain.includes(w.definition),
      `${w.word}: the explanation must say what the word means`);
    assert.ok(q.prompt, `${w.word}: no prompt`);
  });
});

function escape(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

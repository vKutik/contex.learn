/* The data contract.
 *
 * CLAUDE.md is JSON-first: no word, sentence, question or definition is
 * written into a view. That makes js/data/ the place a mistake reaches the
 * learner from, and the place no amount of careful UI work can defend. Every
 * assumption the screens make about this data is asserted here, so adding a
 * word or a passage either satisfies the contract or fails the deploy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { words } from '../../js/data/words.js';
import { lessons } from '../../js/data/lessons.js';
import { passages } from '../../js/data/passages.js';
import { pronunciations } from '../../js/data/pronunciation.js';
import { wordById, lessonWords, shelfOf, DAILY_NEW_LIMIT } from '../../js/data.js';
import { surfaceOf, blankOf } from '../../js/components/word.js';
import { abs } from '../helpers/paths.mjs';

const headwords = new Set(words.map(w => w.word));
const marksIn = text => [...text.matchAll(/data-word="([^"]+)"/g)].map(m => m[1]);

/* ---------- words ---------- */

test('there are a hundred words and the app is built for a hundred', () => {
  assert.equal(words.length, 100);
});

test('a word can be looked up by its id, because wordById indexes the array', () => {
  words.forEach((w, i) => assert.equal(w.id, i,
    `words.js must stay in id order: index ${i} holds id ${w.id}`));
  assert.equal(wordById(7), words[7]);
});

test('every word carries every field the card shows', () => {
  for(const w of words){
    for(const field of ['word','pos','ipa','definition','opposite','translation']){
      assert.equal(typeof w[field], 'string', `${w.word}: ${field} must be a string`);
      assert.ok(w[field].length, `${w.word}: ${field} is empty`);
    }
    assert.ok(Array.isArray(w.examples) && w.examples.length >= 2,
      `${w.word}: the card steps through examples, so it needs at least two`);
  }
});

test('no headword appears twice', () => {
  assert.equal(headwords.size, words.length);
});

test('every part of speech is one the quiz can group by', () => {
  const known = new Set(['noun','verb','adj','adv','phrase']);
  for(const w of words) assert.ok(known.has(w.pos), `${w.word}: unknown pos "${w.pos}"`);
});

test('every part of speech has enough words to build a question from', () => {
  const byPos = {};
  for(const w of words) byPos[w.pos] = (byPos[w.pos] || 0) + 1;
  for(const [pos, n] of Object.entries(byPos)){
    assert.ok(n >= 4, `only ${n} words are "${pos}" - a gap fill needs four options`);
  }
});

test('every example marks its target in {braces}', () => {
  for(const w of words) for(const ex of w.examples){
    assert.notEqual(surfaceOf(ex), '', `${w.word}: "${ex}" marks nothing`);
  }
});

test('blanking an example never leaves the answer visible in it', () => {
  for(const w of words) for(const ex of w.examples){
    const surface = surfaceOf(ex);
    assert.doesNotMatch(blankOf(ex), new RegExp(`\\b${surface}\\b`, 'i'),
      `${w.word}: "${ex}" still shows the answer once the gap is cut`);
  }
});

/* ---------- lessons ---------- */

test('twenty lessons of five words cover the hundred exactly once', () => {
  assert.equal(lessons.length, 20);
  const ids = lessons.flatMap(l => l.wordIds);
  assert.equal(ids.length, 100);
  assert.equal(new Set(ids).size, 100, 'a word appears in two lessons');
  assert.deepEqual([...ids].sort((a,b) => a-b), words.map(w => w.id));
});

test('a lesson opens exactly one daily batch', () => {
  for(const l of lessons) assert.equal(l.wordIds.length, DAILY_NEW_LIMIT,
    `lesson ${l.id} does not hold one batch`);
});

test('lesson ids are unique and every lesson has a title and a text', () => {
  assert.equal(new Set(lessons.map(l => l.id)).size, lessons.length);
  for(const l of lessons){
    assert.ok(l.title && l.title.length, `lesson ${l.id} has no title`);
    assert.ok(l.text && l.text.length > 100, `lesson ${l.id} has no story`);
  }
});

test('lessonWords resolves every id, so no lesson can point at a missing word', () => {
  for(const l of lessons){
    const ws = lessonWords(l);
    assert.equal(ws.length, 5);
    assert.ok(ws.every(Boolean), `lesson ${l.id} points at a word that does not exist`);
  }
});

test('a lesson story really uses all five of its words', () => {
  for(const l of lessons){
    const marked = new Set(marksIn(l.text));
    for(const w of lessonWords(l)){
      assert.ok(marked.has(w.word), `lesson ${l.id} never marks "${w.word}"`);
    }
  }
});

test('every comprehension question is answerable in one tap', () => {
  for(const l of lessons){
    assert.ok(l.quiz.length >= 1, `lesson ${l.id} has no questions`);
    for(const q of l.quiz){
      assert.ok(q.question && q.question.length, `lesson ${l.id}: a question with no text`);
      assert.ok(q.options.length >= 2, `lesson ${l.id}: a question with one option`);
      assert.ok(q.correctIndex >= 0 && q.correctIndex < q.options.length,
        `lesson ${l.id}: correctIndex points outside the options`);
      assert.equal(new Set(q.options).size, q.options.length,
        `lesson ${l.id}: two identical options`);
      assert.ok(q.options.every(o => o && o.trim()), `lesson ${l.id}: an empty option`);
    }
  }
});

test('every comprehension question names the lesson word it checks', () => {
  for(const l of lessons)
    for(const q of l.quiz)
      assert.ok(l.wordIds.includes(q.wordId),
        `lesson ${l.id}: "${q.question}" is not tied to one of its words - its answer would log w:null`);
});

/* ---------- passages ---------- */

test('a passage can be looked up by its id, because the reader indexes the array', () => {
  passages.forEach((p, i) => assert.equal(p.id, i,
    `passages.js must stay in id order: index ${i} holds id ${p.id}`));
});

/* `plain` is the wordless retelling a new word's card shows under its
   definition - a picture for an abstract word. It must not give the word away. */
test('a word\'s plain scene is one short sentence that never names the word', () => {
  const stem = w => w.toLowerCase().replace(/(ing|edly|ly|ied|ies|es|ed|s|y)$/, '');
  for(const w of words){
    if(w.plain === undefined) continue;
    assert.equal(typeof w.plain, 'string', `${w.word}: plain must be a string`);
    assert.ok(w.plain.length > 0 && w.plain.length <= 90, `${w.word}: plain must be 1-90 characters`);
    assert.ok(!/[{}]/.test(w.plain), `${w.word}: plain carries no {braces}`);
    assert.equal((w.plain.match(/[.!?]/g) || []).length, 1, `${w.word}: plain is one sentence`);
    assert.match(w.plain.trim(), /[.!?]$/, `${w.word}: plain ends its sentence`);
    const tokens = w.plain.toLowerCase().replace(/[.,!?;:]/g, '').split(/\s+/);
    assert.ok(!tokens.some(t => t === w.word.toLowerCase() || stem(t) === stem(w.word)),
      `${w.word}: plain must not give the word away`);
  }
});

test('every word owns a full shelf of ten, numbered 0 to 9', () => {
  assert.equal(passages.length, words.length * 10);
  for(const w of words){
    const shelf = shelfOf(w.id);
    assert.equal(shelf.length, 10, `${w.word}: shelf of ${shelf.length}`);
    assert.deepEqual(shelf.map(p => p.slot), [0,1,2,3,4,5,6,7,8,9], `${w.word}: slots out of order`);
    assert.ok(shelf.every(p => p.w === w.id), `${w.word}: a passage from another shelf`);
  }
});

test('every passage belongs to a real word and marks it in the text', () => {
  for(const p of passages){
    const owner = wordById(p.w);
    assert.ok(owner, `passage ${p.id} belongs to word ${p.w}, which does not exist`);
    assert.ok(marksIn(p.text).includes(owner.word),
      `passage ${p.id} never marks its own word "${owner.word}"`);
  }
});

test('every marked word in every text is a headword the tooltip can find', () => {
  for(const source of [...lessons, ...passages]){
    for(const mark of marksIn(source.text)){
      assert.ok(headwords.has(mark),
        `text ${source.id} marks "${mark}", which is not in words.js - the tooltip would be blank`);
    }
  }
});

test('the `also` list only ever names real course words, never the owner', () => {
  for(const p of passages){
    assert.ok(Array.isArray(p.also));
    for(const id of p.also){
      assert.ok(wordById(id), `passage ${p.id}: also names ${id}, which does not exist`);
      assert.notEqual(id, p.w, `passage ${p.id}: also names its own word`);
    }
  }
});

test('a passage has a text and a source field, even when the source is empty', () => {
  for(const p of passages){
    assert.ok(p.text && p.text.length > 40, `passage ${p.id} is too short to read`);
    assert.equal(typeof p.source, 'string', `passage ${p.id}: source must be a string`);
  }
});


/* ---------- pronunciation ---------- */

test('every word has a recording, and every recording is on disk', () => {
  for(const w of words){
    const rec = pronunciations[w.id];
    assert.ok(rec, `${w.word}: no recording`);
    assert.ok(fs.existsSync(abs(rec.src)), `${w.word}: ${rec.src} is missing from the repo`);
  }
});

test('no recording is left in the data for a word that no longer exists', () => {
  for(const id of Object.keys(pronunciations)){
    assert.ok(wordById(+id), `a recording is listed for word ${id}, which does not exist`);
  }
});

test('every recording keeps the credit its licence asks for', () => {
  for(const [id, rec] of Object.entries(pronunciations)){
    assert.ok(rec.by && rec.by.length, `word ${id}: no speaker credited`);
    assert.match(rec.lic, /^CC|^Public domain/, `word ${id}: unclear licence "${rec.lic}"`);
    assert.match(rec.page, /^https:\/\//, `word ${id}: no link back to the source page`);
  }
});

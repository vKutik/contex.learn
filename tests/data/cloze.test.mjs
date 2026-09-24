/* The cloze cards: js/data/cloze.js, generated from cloze_all.json.
 *
 * tools_cloze.py refuses to write a card that breaks the schema, but the
 * module can still drift from the JSON (an edit to one without re-running the
 * script) or be edited by hand. So the shape every screen assumes is asserted
 * here against the module the browser loads, and the module against its
 * source.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloze } from '../../js/data/cloze.js';
import { clozeFor } from '../../js/data.js';
import { words } from '../../js/data/words.js';
import { read } from '../helpers/paths.mjs';

const all = Object.values(cloze).flat();
const ANCHORS = ['df', 'cq', 'ca', 'ct', 'cl'];

test('every word has exactly five cards, one of each anchor', () => {
  for(const w of words){
    const cards = clozeFor(w.id);
    assert.equal(cards.length, 5, `${w.word}: ${cards.length} cards`);
    assert.deepEqual(cards.map(c => c.t).sort(), [...ANCHORS].sort(), `${w.word}: anchors repeat`);
  }
  assert.deepEqual(Object.keys(cloze).map(Number).sort((a, b) => a - b), words.map(w => w.id),
    'a card set for a word that does not exist');
});

test('every sentence has one blank, 8-16 words, and the blank is not in the first two', () => {
  for(const c of all){
    assert.equal(c.s.split('____').length, 2, `${c.id}: "${c.s}"`);
    assert.doesNotMatch(c.s, /_{5}/, `${c.id}: a blank of the wrong width`);
    const tokens = c.s.split(/\s+/);
    assert.ok(tokens.length >= 8 && tokens.length <= 16, `${c.id}: ${tokens.length} words`);
    assert.ok(tokens.findIndex(t => t.includes('____')) >= 2, `${c.id}: the blank opens the sentence`);
  }
});

test('every answer is there, lower case, and not also listed as an alternative', () => {
  for(const c of all){
    assert.ok(c.a && c.a.trim(), `${c.id}: empty answer`);
    assert.equal(c.a, c.a.toLowerCase(), `${c.id}: the blank is mid-sentence, so the answer is lower case`);
    assert.ok(!c.alt.includes(c.a.toLowerCase()), `${c.id}: alt contains the answer`);
    assert.ok(c.alt.every(a => a === a.toLowerCase()), `${c.id}: alt is compared lower-cased`);
  }
});

test('card ids are "<wordId>:<index>" and never repeat', () => {
  const ids = all.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate card ids');
  for(const [wordId, cards] of Object.entries(cloze)){
    cards.forEach((c, n) => assert.equal(c.id, `${wordId}:${n}`));
  }
});

test('every rejected word comes with its reason', () => {
  for(const c of all){
    assert.ok(Object.keys(c.why).length >= 1, `${c.id}: nothing rejected`);
    for(const [word, reason] of Object.entries(c.why)){
      assert.equal(word, word.toLowerCase(), `${c.id}: "${word}" is looked up lower-cased`);
      assert.ok(reason && !reason.startsWith('—'), `${c.id}: "${word}" has no reason`);
    }
  }
});

test('js/data/cloze.js is what tools_cloze.py makes of cloze_all.json - re-run it after an edit', () => {
  const source = JSON.parse(read('cloze_all.json'));
  for(const w of source){
    w.cards.forEach((c, n) => {
      const card = clozeFor(w.id)[n];
      const where = `${w.id}:${n}`;
      assert.ok(card, `${where} is in the JSON but not in the module`);
      assert.equal(card.s, c.sentence, `${where}: sentence differs`);
      assert.equal(card.a, c.answer, `${where}: answer differs`);
      assert.deepEqual(card.alt, (c.also_accept || []).map(a => a.toLowerCase()), `${where}: alt differs`);
      assert.deepEqual(Object.keys(card.why), c.rejected.map(r => r.split(' — ')[0].toLowerCase()),
        `${where}: rejected words differ`);
    });
  }
  assert.equal(all.length, source.reduce((n, w) => n + w.cards.length, 0));
});

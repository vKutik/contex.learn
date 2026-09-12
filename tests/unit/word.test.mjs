/* word.js - the {braces} convention and the shared card face.
 *
 * CLAUDE.md: only this module may read the braces convention. Three screens
 * depend on these four one-liners, so they are worth pinning down exactly.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { surfaceOf, blankOf, markedOf, exampleOf, wordFace } from '../../js/components/word.js';
import * as store from '../../js/storage.js';
import { fresh } from '../helpers/fixture.mjs';
import { words } from '../../js/data/words.js';

beforeEach(fresh);

const WORD = {
  id: 900, word:'shallow', pos:'adj', ipa:'ˈʃæloʊ', translation:'мілкий',
  definition:'not deep', opposite:'deep',
  examples:['The {shallow} end.', 'It is {shallow} here.', 'A {shallow} answer.']
};

test('surfaceOf reads the marked form as the sentence spells it', () => {
  assert.equal(surfaceOf('Her hands {trembled} once.'), 'trembled');
  assert.equal(surfaceOf('{Grief} takes its own time.'), 'Grief');
});

test('surfaceOf returns an empty string rather than throwing on an unmarked sentence', () => {
  assert.equal(surfaceOf('nothing marked here'), '');
});

test('blankOf cuts the word out and leaves a gap to fill', () => {
  assert.equal(blankOf('The {shallow} end.'), 'The <u> </u> end.');
});

test('markedOf highlights the word, and can put another word in its place', () => {
  assert.equal(markedOf('The {shallow} end.'), 'The <mark>shallow</mark> end.');
  assert.equal(markedOf('The {shallow} end.', 'deep'), 'The <mark>deep</mark> end.');
});

test('only the first marker in a sentence is treated as the target', () => {
  assert.equal(surfaceOf('{one} and {two}'), 'one');
  assert.equal(blankOf('{one} and {two}'), '<u> </u> and {two}');
});

test('exampleOf follows the stored pointer and wraps round the shelf', async () => {
  assert.equal(exampleOf(WORD), WORD.examples[0]);
  await store.setExample(WORD.id, 2);
  assert.equal(exampleOf(WORD), WORD.examples[2]);
  await store.setExample(WORD.id, WORD.examples.length);
  assert.equal(exampleOf(WORD), WORD.examples[0], 'the pointer wraps, it does not fall off');
});

test('the card face carries everything the card promises', () => {
  const html = wordFace(WORD);
  assert.match(html, /shallow/);
  assert.match(html, /ˈʃæloʊ/);
  assert.match(html, /adj/);
  assert.match(html, /not deep/);
  assert.match(html, /opposite: deep/);
  assert.match(html, /data-say/, 'the listen button is part of the face');
  assert.match(html, /example 1 of 3/);
  assert.match(html, /<mark>shallow<\/mark>/, 'the example shows the word highlighted');
});

test('the face hides the translation - the data is kept, the display is not', () => {
  assert.doesNotMatch(wordFace(WORD), /мілкий/);
});

test('a word with no antonym does not get an empty "opposite:" line', () => {
  assert.doesNotMatch(wordFace({ ...WORD, opposite:'—' }), /opposite:/);
});

test('familiarity dots appear on the face only when a familiarity is passed', () => {
  assert.doesNotMatch(wordFace(WORD), /class="fam/);
  assert.match(wordFace(WORD, { level:2, cooling:false }), /class="fam/);
});

test('every real example in the word list round-trips through all three helpers', () => {
  for(const w of words){
    for(const ex of w.examples){
      const surface = surfaceOf(ex);
      assert.notEqual(surface, '', `${w.word}: "${ex}" has no {braces}`);
      assert.ok(blankOf(ex).includes('<u> </u>'), `${w.word}: no gap produced`);
      assert.equal(markedOf(ex), ex.replace(`{${surface}}`, `<mark>${surface}</mark>`));
    }
  }
});

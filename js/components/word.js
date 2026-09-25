/* word.js - a word and the sentences that carry it.
 *
 * Two jobs, both of which used to be copied between screens:
 *
 *   1. the {braces} convention. Every example in js/data/words.js marks its
 *      target word in braces - "the water was {shallow}" - and three screens
 *      need to read it: shown as a highlight, cut out as a gap, or read back
 *      as the bare surface form. That regex lives here and nowhere else.
 *
 *   2. the face of a word: how it sounds, what it means, one sentence around
 *      it. Stage 1 and the review reveal show exactly the same block, so it
 *      is written once.
 */
import { familiarityDots } from './progress.js';
import { say } from './audio.js';
import * as store from '../storage.js';

/* ---------- the {braces} marker ---------- */
const MARKER = /\{(.+?)\}/;

/** The marked form as it appears in the sentence: "{shallow}" -> "shallow". */
export const surfaceOf = ex => (ex.match(MARKER) || [, ''])[1];

/** The sentence with the word cut out of it, ready to be guessed back. */
export const blankOf = ex => ex.replace(MARKER, '<u> </u>');

/** The sentence with the word highlighted, as the reading screen shows it.
 *  Pass `text` to highlight a different word in its place - which is how the
 *  context-match mechanic builds its wrong answer. */
export const markedOf = (ex, text) =>
  ex.replace(MARKER, (_, m) => `<mark>${text ?? m}</mark>`);

/* ---------- the ____ blank of a cloze card ----------
   Hand-written cloze cards (js/data/cloze.js) mark their gap with four
   underscores rather than braces, because the answer is not always the
   headword: "Her hands ____ as she opened the letter" wants "trembled". */
const BLANK = '____';

/** A cloze sentence with its gap drawn the way blankOf draws one. */
export const gapOf = s => s.replace(BLANK, '<u> </u>');

/** A cloze sentence with the answer written back in and highlighted. */
export const filledOf = (s, answer) => s.replace(BLANK, `<mark>${answer}</mark>`);

/** One sentence as words only - braces, blank, case and punctuation gone -
 *  so an example and a cloze card can be compared as the same sentence.
 *  `answer` fills a cloze card's blank first. */
export const wordsOf = (s, answer = '') =>
  s.replace(MARKER, '$1').replace(BLANK, answer)
   .toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim();

/* ---------- the plain-scene hint for abstract words ---------- */
/** A quiet, wordless retelling of the card's first example - shown the
 *  first time a word is met, and again on the review's answer side while the
 *  word has not settled, so an abstract word (`cheerful`, `grief`) gets a
 *  picture the way a concrete one already has - in English, never a
 *  translation. Optional: a word with no `plain` field gets nothing. */
const plainOf = (word, withPlain) =>
  (withPlain && word.plain) ? `<div class="plain">${word.plain}</div>` : '';

/* ---------- which example a word is showing ---------- */
export const exampleOf = word => word.examples[store.getExample(word.id) % word.examples.length];
const exampleNo = word => (store.getExample(word.id) % word.examples.length) + 1;
const nextExample = word =>
  store.setExample(word.id, (store.getExample(word.id) + 1) % word.examples.length);

/* ---------- the face ---------- */
/**
 * @param {object} word
 * @param {{level:number,cooling:boolean}} [fam] from srs.familiarity()
 * @param {boolean} [withPlain] show the plain scene: a first meeting, or a
 *   word that has not settled yet (srs.unsettled)
 * @returns {string} markup for the inside of a card
 */
export const wordFace = (word, fam, withPlain = false) => `
  <div class="word">${word.word}${fam ? familiarityDots(fam) : ''}</div>
  <div class="pos">/${word.ipa}/ · ${word.pos}</div>
  <button class="say" data-say>🔊 listen</button>
  <!-- word.translation exists on every word (see js/data/words.js) but is
       hidden in the UI for now, per request - data stays, display doesn't. -->
  <div class="def">${word.definition}</div>
  ${plainOf(word, withPlain)}
  <div class="ex">${markedOf(exampleOf(word))}</div>
  ${word.opposite !== '—' ? `<div class="anto">opposite: ${word.opposite}</div>` : ''}
  <div class="exnav">example ${exampleNo(word)} of ${word.examples.length}</div>`;

/** Wire the face's two controls: listen, and step to the next example.
 *  The [data-alt] button is optional - a screen that has none just skips it. */
export function wireWordFace(container, word, onRerender){
  container.querySelector('[data-say]').onclick = () => say(word.id, word.word);
  const alt = container.querySelector('[data-alt]');
  if(alt) alt.onclick = async () => { await nextExample(word); onRerender(); };
}

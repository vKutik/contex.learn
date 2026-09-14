// run.js - tests for the `plain` field (see task brief).
// Opened as tests/index.html in a browser. Not part of the deploy gate
// (node tests/run.mjs), not loaded by the app.
//
// No test framework: a 10-line assert helper plus a pass/fail counter.

import { plainOf, wordFace } from '../js/components/word.js';
import { words } from '../js/data/words.js';

let pass = 0, fail = 0;
const failures = [];

function assert(name, condition){
  if(condition){ pass++; }
  else { fail++; failures.push(name); }
  const line = document.createElement('div');
  line.className = condition ? 'pass' : 'fail';
  line.textContent = (condition ? 'PASS  ' : 'FAIL  ') + name;
  document.getElementById('results').appendChild(line);
  console[condition ? 'log' : 'error']((condition ? 'PASS  ' : 'FAIL  ') + name);
}

/* ---------- fixtures ---------- */

const wordWithoutPlain = {
  id: 9001, word: 'shallow', pos: 'adj', ipa: 'x', translation: 'x',
  definition: 'not deep', opposite: 'deep',
  examples: ['The children played in the {shallow} end.'],
};

const wordWithPlain = {
  id: 9002, word: 'cheerful', pos: 'adj', ipa: 'x', translation: 'x',
  definition: 'happy and showing it', opposite: 'gloomy',
  examples: ['She gave a {cheerful} wave from the window.'],
  plain: 'She smiled and waved to me from the window.',
};

/* ---------- plainOf(word, isNew) ---------- */

assert('no plain field, isNew=true -> empty string',
  plainOf(wordWithoutPlain, true) === '');

assert('has plain, isNew=false -> empty string',
  plainOf(wordWithPlain, false) === '');

assert('has plain, isNew=true -> result contains word.plain text',
  plainOf(wordWithPlain, true).includes(wordWithPlain.plain));

assert('has plain, isNew=true -> markup carries class "plain"',
  /class="[^"]*\bplain\b[^"]*"/.test(plainOf(wordWithPlain, true)));

assert('plainOf does not import storage.js (no localStorage access for this logic)', (() => {
  // isNew is passed in as an argument; plainOf itself must not read storage.
  // Detected by checking the function body text for a storage import/reference.
  const src = plainOf.toString();
  return !/store\.|localStorage/.test(src);
})());

/* ---------- order inside wordFace ---------- */

assert('new word with plain: .plain block comes before .ex block', (() => {
  const face = wordFace(wordWithPlain, null, true);
  const plainIdx = face.indexOf('class="plain"');
  const exIdx = face.indexOf('class="ex"');
  return plainIdx !== -1 && exIdx !== -1 && plainIdx < exIdx;
})());

assert('familiar word with plain: no .plain block in markup', (() => {
  const face = wordFace(wordWithPlain, null, false);
  return !/class="[^"]*\bplain\b[^"]*"/.test(face);
})());

assert('wordFace(word, fam) with two arguments still works, isNew defaults to false', (() => {
  const face = wordFace(wordWithPlain, null);
  return typeof face === 'string' && !/class="[^"]*\bplain\b[^"]*"/.test(face);
})());

/* ---------- data: js/data/words.js ---------- */

const STOP_ENDS = /[.!?]$/;

function stem(w){
  // crude root for the "does plain leak the target word" check: strip common
  // suffixes so "greedy"/"greedily", "hesitate"/"hesitated" still match.
  return w.toLowerCase().replace(/(ing|edly|ly|ied|ies|es|ed|s|y)$/, '');
}

for(const word of words){
  if(word.plain === undefined) continue;

  assert(`${word.word}: plain is a non-empty string`,
    typeof word.plain === 'string' && word.plain.length > 0);

  assert(`${word.word}: plain has no {braces}`,
    !word.plain.includes('{') && !word.plain.includes('}'));

  assert(`${word.word}: plain does not contain the target word`, (() => {
    const root = stem(word.word);
    const tokens = word.plain.toLowerCase().replace(/[.,!?;:]/g, '').split(/\s+/);
    return !tokens.some(t => stem(t) === root || t === word.word.toLowerCase());
  })());

  assert(`${word.word}: plain is one sentence (exactly one end mark, at the end)`, (() => {
    const marks = word.plain.match(/[.!?]/g) || [];
    return marks.length === 1 && STOP_ENDS.test(word.plain.trim());
  })());

  assert(`${word.word}: plain is no longer than 90 characters`,
    word.plain.length <= 90);

  assert(`${word.word}: has at least one example in examples[]`,
    Array.isArray(word.examples) && word.examples.length > 0);
}

/* ---------- summary ---------- */

const summary = `${pass} passed, ${fail} failed`;
const summaryEl = document.getElementById('summary');
summaryEl.textContent = summary;
summaryEl.className = fail === 0 ? 'pass' : 'fail';
console.log('----');
console.log(summary);
if(fail) console.error('Failed:', failures);

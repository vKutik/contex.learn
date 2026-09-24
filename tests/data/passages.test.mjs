/* The quality bar on reading practice: js/data/passages.js against
 * passages_audit.json.
 *
 * Whether a passage uses its word in the card's sense, and whether the text
 * around it lets a learner work the word out, cannot be computed - so every
 * passage carries a judgement (S sense, C context, R readable, A alone, 0-2
 * each; tools_passages.py explains the scale) made about one exact text,
 * recorded with that text's hash. Changing a passage without judging it
 * again breaks the hash and fails here. The parts that can be measured are
 * measured here too, and they do not take a judgement's word for it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { passages } from '../../js/data/passages.js';
import { words } from '../../js/data/words.js';
import { read } from '../helpers/paths.mjs';

const audit = new Map(JSON.parse(read('passages_audit.json')).map(j => [j.id, j]));
const sha = text => crypto.createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 12);
const plain = text => text.replace(/<[^>]+>/g, '');

test('every passage has been judged, and judged as it reads now', () => {
  assert.equal(audit.size, passages.length, 'an audit entry for a passage that does not exist, or one missing');
  for(const p of passages){
    const j = audit.get(p.id);
    assert.ok(j, `passage ${p.id} has never been judged`);
    assert.equal(j.sha, sha(p.text),
      `passage ${p.id} changed after it was judged - read it again, then python3 tools_passages.py --stamp`);
  }
});

test('every passage clears the bar: right sense, and nothing below 1', () => {
  for(const p of passages){
    const { s, c, r, a } = audit.get(p.id);
    assert.ok(s >= 1, `passage ${p.id} uses its word in a sense the course does not teach`);
    assert.ok(Math.min(c, r, a) >= 1, `passage ${p.id}: C${c} R${r} A${a}`);
    assert.ok(c + r + a >= 4, `passage ${p.id}: C+R+A = ${c + r + a}`);
  }
});

test('a neighbouring sense always carries its label, and the card sense never does', () => {
  for(const p of passages){
    const { s } = audit.get(p.id);
    if(s === 1) assert.ok(p.sense, `passage ${p.id} is judged a neighbouring sense but the tooltip would show the card's`);
    else assert.equal(p.sense, undefined, `passage ${p.id} is the card's sense but is labelled "${p.sense}"`);
  }
});

test('every shelf teaches the card: at least seven of ten in its own sense', () => {
  for(const w of words){
    const own = passages.filter(p => p.w === w.id && audit.get(p.id).s === 2).length;
    assert.ok(own >= 7, `${w.word}: only ${own} of 10 passages in the card's sense`);
  }
});

test('no passage still shows the seams of the book it was cut from', () => {
  for(const p of passages){
    const t = plain(p.text);
    assert.doesNotMatch(t, /(^|\W)_\w|\w_(\W|$)/, `passage ${p.id}: _italics_ markup left in`);
    assert.doesNotMatch(t, /\b(Mr|Mrs|Dr|St)\.\s*$/, `passage ${p.id}: cut off in the middle of a name`);
    assert.match(t.trim(), /[.!?…]["'”’)]*$/, `passage ${p.id}: does not end a sentence`);
    assert.doesNotMatch(t, /^[a-z]/, `passage ${p.id}: starts mid-sentence`);
    const longest = Math.max(...t.split(/(?<=[.!?])["'”’)]*\s+/).map(s => s.split(/\s+/).length));
    assert.ok(longest <= 45, `passage ${p.id}: a ${longest}-word sentence`);
  }
});

test('the `also` list is exactly the other course words the text marks', () => {
  for(const p of passages){
    const marked = [...new Set([...p.text.matchAll(/data-word="([^"]+)"/g)].map(m => m[1]))]
      .map(word => words.find(w => w.word === word).id).filter(id => id !== p.w);
    assert.deepEqual([...p.also].sort((a, b) => a - b), marked.sort((a, b) => a - b), `passage ${p.id}`);
  }
});

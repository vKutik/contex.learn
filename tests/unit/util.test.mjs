/* util.js - the two array helpers. Both are used by the router and the quiz,
 * so a regression here is a regression in every screen at once. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shuffle, one } from '../../js/util.js';

test('shuffle returns a copy and never touches the original', () => {
  const source = [1,2,3,4,5];
  const copy = source.slice();
  const out = shuffle(source);
  assert.notEqual(out, source, 'must be a new array');
  assert.deepEqual(source, copy, 'the original is left alone');
});

test('shuffle keeps every element exactly once', () => {
  const source = Array.from({length:20}, (_,i) => i);
  for(let run = 0; run < 50; run++){
    assert.deepEqual(shuffle(source).sort((a,b)=>a-b), source);
  }
});

test('shuffle actually reorders', () => {
  const source = Array.from({length:10}, (_,i) => i);
  // one run can legitimately come back in order (1 in 3.6 million); 200 cannot
  const moved = Array.from({length:200}, () => shuffle(source))
    .some(out => out.some((v,i) => v !== source[i]));
  assert.ok(moved, 'shuffle produced the identity 200 times running');
});

test('shuffle copes with empty and single-element arrays', () => {
  assert.deepEqual(shuffle([]), []);
  assert.deepEqual(shuffle(['only']), ['only']);
});

test('one draws a member of the array', () => {
  const source = ['a','b','c'];
  for(let run = 0; run < 100; run++) assert.ok(source.includes(one(source)));
});

test('one returns undefined for an empty array rather than throwing', () => {
  assert.equal(one([]), undefined);
});

test('one can draw every element', () => {
  const seen = new Set();
  for(let run = 0; run < 300; run++) seen.add(one([1,2,3]));
  assert.deepEqual([...seen].sort(), [1,2,3]);
});

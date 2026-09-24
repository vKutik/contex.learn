/* util.js - the shared helpers. Each is used by more than one module, so a
 * regression here is a regression in every screen at once. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shuffle, one, dayKey, plural } from '../../js/util.js';

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

/** Run `fn` with the process in time zone `tz`, then put the old one back. */
function inZone(tz, fn){
  const real = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); }
  finally { if(real === undefined) delete process.env.TZ; else process.env.TZ = real; }
}

test('a day ends at the learner\'s midnight, not at UTC\'s', () => {
  // 23:30 UTC on 10 March is already 01:30 on 11 March in Kyiv: an answer
  // given then belongs to the 11th, and "tomorrow" is the 12th
  const lateUtc = new Date('2026-03-10T23:30:00Z');
  inZone('Europe/Kyiv', () => {
    assert.equal(dayKey(0, lateUtc), '2026-03-11');
    assert.equal(dayKey(1, lateUtc), '2026-03-12');
  });
  inZone('America/New_York', () => assert.equal(dayKey(0, lateUtc), '2026-03-10'));
});

test('dayKey counts whole calendar days across months, years and clock changes', () => {
  inZone('Europe/Kyiv', () => {
    assert.equal(dayKey(1, new Date(2026, 0, 31, 12)), '2026-02-01');
    assert.equal(dayKey(-1, new Date(2026, 0, 1, 12)), '2025-12-31');
    // the night the clocks go forward is 23 hours long and still one day
    assert.equal(dayKey(1, new Date(2026, 2, 28, 12)), '2026-03-29');
    assert.equal(dayKey(1, new Date(2026, 2, 29, 0, 30)), '2026-03-30');
  });
});

test('plural agrees with the count', () => {
  assert.equal(plural(1, 'word'), '1 word');
  assert.equal(plural(0, 'word'), '0 words');
  assert.equal(plural(7, 'more text'), '7 more texts');
});

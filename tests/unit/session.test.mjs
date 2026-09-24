/* session.js - the rules of one review sitting.
 *
 * The learner's complaint was concrete: "every wrong answer makes the number
 * of questions go up". These tests hold the module to the opposite promise -
 * the denominator is fixed at the door and the counter can only climb - and
 * check the mechanics that make a miss forgiving without making the sitting
 * open-ended: it resurfaces GAP cards later, drops after MAX_MISSES, and the
 * whole thing has a hard stop regardless of how badly it is going.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as session from '../../js/session.js';

// The spec constants session.js keeps to itself (only SESSION_SIZE is
// exported, because only SESSION_SIZE is needed outside this module - see
// deploy/release.test.mjs's "every export is imported by something").
const GAP = 3, MAX_MISSES = 2, MAX_ANSWERS = 20;

/** A tiny seeded PRNG so a "many random sequences" test is still
 *  deterministic - no two runs of the suite can disagree. */
function mulberry32(seed){
  return function(){
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- batch size ---------- */

test('a sitting takes at most SESSION_SIZE words, most-overdue-first order kept', () => {
  const ids = [10,11,12,13,14,15,16,17,18,19];
  const state = session.startSession(ids);
  assert.equal(state.total, session.SESSION_SIZE);
  assert.deepEqual(state.queue, ids.slice(0, session.SESSION_SIZE),
    'the first SESSION_SIZE ids, in the order they were given');
});

test('fewer due words than SESSION_SIZE is not padded out', () => {
  const state = session.startSession([1,2,3]);
  assert.equal(state.total, 3);
  assert.equal(session.isFinished(state), false, 'three words are still waiting to be graded');
  assert.equal(session.current(state), 1);
});

test('an empty batch is a finished sitting from the start', () => {
  const state = session.startSession([]);
  assert.equal(state.total, 0);
  assert.equal(session.isFinished(state), true);
});

/* ---------- the miss comes back soon ---------- */

test('a Forgot re-inserts the word exactly GAP cards later', () => {
  const state = session.startSession([1,2,3,4,5]);
  const next = session.answer(state, 1, 0);
  assert.deepEqual(next.queue, [2,3,4,1,5],
    'three other cards (2,3,4) come before it resurfaces');
  assert.equal(next.misses[1], 1);
});

test('a Forgot near the end of the queue lands at the end, not past it', () => {
  const state = session.startSession([1,2,3]);
  const next = session.answer(state, 1, 0);
  assert.deepEqual(next.queue, [2,3,1], 'only two cards remain, so it goes to the end');
});

/* ---------- the miss limit ---------- */

test('a word forgotten MAX_MISSES times drops out of the sitting', () => {
  let state = session.startSession([1]);
  state = session.answer(state, 1, 0);          // 1st Forgot: still in play
  assert.equal(state.dropped.length, 0);
  assert.ok(state.queue.includes(1));

  state = session.answer(state, 1, 0);          // 2nd Forgot: MAX_MISSES reached
  assert.deepEqual(state.dropped, [1]);
  assert.ok(!state.queue.includes(1), 'a dropped word leaves the sitting');
});

test('a dropped word counts as finished for the counter', () => {
  let state = session.startSession([1,2]);
  state = session.answer(state, 1, 0);
  state = session.answer(state, 2, 2);          // 2: Good, finished normally
  state = session.answer(state, 1, 0);          // 1 drops now (2nd miss)
  assert.deepEqual(session.progress(state), { done: 2, total: 2 });
  assert.deepEqual(state.remembered, [2]);
  assert.deepEqual(state.dropped, [1]);
});

/* ---------- the hard stop ---------- */

test('a hard stop after MAX_ANSWERS ends the sitting even with cards left', () => {
  // A big pool, and never the same word forgotten twice (grade it Good on its
  // second showing instead) - so the only thing that can end this run is the
  // MAX_ANSWERS cap, not a drop and not an empty queue.
  let state = { total: 30, queue: Array.from({ length: 30 }, (_, i) => i),
                misses: {}, remembered: [], dropped: [], answers: 0, ended: false };
  const forgottenOnce = new Set();
  for(let n = 0; n < MAX_ANSWERS; n++){
    assert.equal(session.isFinished(state), false, `should still be running at answer ${n}`);
    const word = session.current(state);
    const grade = forgottenOnce.has(word) ? 2 : (forgottenOnce.add(word), 0);
    state = session.answer(state, word, grade);
  }
  assert.equal(state.answers, MAX_ANSWERS);
  assert.equal(session.isFinished(state), true);
  assert.ok(state.queue.length > 0, 'unfinished words are left in the queue, untouched');
  assert.equal(state.dropped.length, 0, 'no word was ever forgotten twice, so nothing was dropped');
});

test('answer() is a no-op once the sitting has ended', () => {
  let state = session.startSession([1]);
  state = session.answer(state, 1, 2);
  assert.equal(session.isFinished(state), true);
  const again = session.answer(state, 1, 2);
  assert.deepEqual(again, state, 'grading after the end changes nothing');
});

/* ---------- the counter only goes up ---------- */

test('progress().done never decreases, whatever the grades, and total never changes', () => {
  for(let seed = 0; seed < 60; seed++){
    const rand = mulberry32(seed);
    const ids = [0,1,2,3,4,5,6];
    let state = session.startSession(ids);
    let lastDone = 0;
    let guard = 0;
    while(!session.isFinished(state)){
      assert.ok(++guard < 1000, 'a sitting must always end');
      const { done, total } = session.progress(state);
      assert.equal(total, ids.length, `seed ${seed}: total drifted`);
      assert.ok(done >= lastDone, `seed ${seed}: done went from ${lastDone} to ${done}`);
      lastDone = done;
      const word = session.current(state);
      const grade = Math.floor(rand() * 4);
      state = session.answer(state, word, grade);
    }
    const final = session.progress(state);
    assert.equal(final.total, ids.length, `seed ${seed}: total drifted at the end`);
    assert.ok(final.done >= lastDone, `seed ${seed}: the last step still must not go backwards`);
    assert.ok(final.done <= final.total, `seed ${seed}: done overshot total`);
    assert.equal(final.done, state.remembered.length + state.dropped.length);
  }
});

test('a word finished with Hard, Good or Easy is remembered, not dropped', () => {
  for(const g of [1,2,3]){
    const state = session.answer(session.startSession([1]), 1, g);
    assert.deepEqual(state.remembered, [1]);
    assert.deepEqual(state.dropped, []);
  }
});

test('current() is null once the sitting has ended', () => {
  const state = session.startSession([]);
  assert.equal(session.isFinished(state), true);
  assert.equal(session.current(state), null);
});

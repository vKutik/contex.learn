/* storage.js - the only module allowed to persist anything.
 *
 * These tests double as the isolation guarantee for the whole unit suite:
 * the first one proves that a run under Node cannot reach a browser profile,
 * so nothing below can corrupt a learner's real progress.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../../js/storage.js';
import { fresh, wordRecord, DAY_MS, today } from '../helpers/fixture.mjs';

beforeEach(fresh);

test('under Node nothing is persisted anywhere - the suite cannot touch real progress', async () => {
  await store.putWord(0, wordRecord());
  assert.equal(store.storageLabel(), 'NOT SAVING',
    'a unit test found a real storage back end; it could be writing to a profile');
  assert.equal(typeof globalThis.localStorage, 'undefined');
});

test('a fresh store is empty in every compartment', () => {
  const s = store.snapshot();
  for(const key of ['words','ex','rw','read','lesson','rsched','log']){
    assert.deepEqual(s[key], {}, `${key} should start empty`);
  }
  assert.deepEqual(s.grants, []);
});

test('load() survives having no back end at all and still returns a usable shape', async () => {
  const s = await store.load();
  for(const key of ['words','ex','rw','read','lesson','rsched','log']) assert.ok(s[key]);
  assert.ok(Array.isArray(s.grants));
});

test('putWord / getWord round trip', async () => {
  await store.putWord(7, wordRecord({ box:2, right:3 }));
  assert.equal(store.getWord(7).box, 2);
  assert.equal(store.getWord(7).right, 3);
  assert.equal(store.getWord(999), undefined, 'an unopened word is undefined, not a blank record');
});

test('the example pointer defaults to 0 and remembers what it was set to', async () => {
  assert.equal(store.getExample(4), 0);
  await store.setExample(4, 3);
  assert.equal(store.getExample(4), 3);
});

test('proving a word from a passage is recorded separately from its card', async () => {
  assert.equal(store.isReadProven(2), false);
  await store.markReadCorrect(2);
  assert.equal(store.isReadProven(2), true);
  assert.equal(store.getWord(2), undefined, 'rw is its own compartment, not part of the word record');
});

test('a passage is marked read once and stays read', async () => {
  assert.equal(store.isPassageRead(51), false);
  await store.markPassageRead(51);
  await store.markPassageRead(51);
  assert.equal(store.isPassageRead(51), true);
  assert.equal(Object.keys(store.snapshot().read).length, 1);
});

test('a lesson stage is null until it is set', async () => {
  assert.equal(store.lessonStage(1), null);
  await store.setLessonStage(1, 'reading');
  assert.equal(store.lessonStage(1), 'reading');
});

test('the daily tally counts right and wrong under today\'s date', async () => {
  assert.deepEqual(store.todayLog(), { right:0, wrong:0 });
  await store.logAnswer(true);
  await store.logAnswer(true);
  await store.logAnswer(false);
  assert.deepEqual(store.todayLog(), { right:2, wrong:1 });
  const key = today();
  assert.deepEqual(Object.keys(store.snapshot().log), [key]);
});

test('a grant is a timestamp, and grantsSince only counts the recent ones', async () => {
  await store.grantNewWords();
  assert.equal(store.grantsSince(Date.now() - DAY_MS), 1);
  assert.equal(store.grantsSince(Date.now() + 1000), 0, 'a grant in the past must age out');
});

test('a reading plan is null until the word has one', async () => {
  assert.equal(store.readingPlan(3), null);
  await store.setReadingPlan(3, { step:2, next:'2030-01-01' });
  assert.deepEqual(store.readingPlan(3), { step:2, next:'2030-01-01' });
});

test('resetAll wipes every compartment', async () => {
  await store.putWord(1, wordRecord());
  await store.markReadCorrect(1);
  await store.markPassageRead(9);
  await store.setLessonStage(1, 'done');
  await store.setReadingPlan(1, { step:1, next:'2030-01-01' });
  await store.logAnswer(true);
  await store.grantNewWords();

  await store.resetAll();

  const s = store.snapshot();
  assert.deepEqual(s.words, {});
  assert.deepEqual(s.rw, {});
  assert.deepEqual(s.read, {});
  assert.deepEqual(s.lesson, {});
  assert.deepEqual(s.rsched, {});
  assert.deepEqual(s.log, {});
  assert.deepEqual(s.grants, []);
});

test('snapshot hands back live state, so callers must not be given a copy to mutate', async () => {
  await store.putWord(5, wordRecord());
  assert.equal(store.snapshot().words[5].box, 0,
    'srs.js reads the snapshot and expects to see what the mutators wrote');
});

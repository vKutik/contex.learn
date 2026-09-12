/* srs.js - the scheduling rules.
 *
 * This is the module a mistake hurts most: it decides what comes back and
 * when, and a learner has no way of noticing that an interval is wrong until
 * weeks later. It is also the easiest module to test properly, because it has
 * no DOM in it - everything below is arranged by writing storage directly and
 * reading the decision back.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../../js/storage.js';
import * as srs from '../../js/srs.js';
import { fresh, seedWord, seedDue, today, dateIn, daysAgo, hoursAgo,
         withClock, DAY_MS } from '../helpers/fixture.mjs';

beforeEach(fresh);

/* ---------- introducing a word ---------- */

test('introduce stamps the word, sets tomorrow, and opens its reading shelf today', async () => {
  await srs.introduce(0);
  const w = store.getWord(0);
  assert.equal(w.box, 0);
  assert.equal(w.seen, 0);
  assert.equal(w.next, dateIn(1), 'the first review is tomorrow');
  assert.equal(w.lastSeen, today());
  assert.ok(w.new > 0, 'the 24h cap needs a timestamp');
  assert.deepEqual(store.readingPlan(0), { step:0, next: today() },
    'the first text is offered straight away');
});

test('introducing a word twice does not restart its 24h clock', async () => {
  await srs.introduce(0);
  const stamp = store.getWord(0).new;
  await srs.introduce(0);
  assert.equal(store.getWord(0).new, stamp);
});

test('introduce leaves an existing reading plan where it is', async () => {
  await store.setReadingPlan(0, { step:4, next:'2030-01-01' });
  await srs.introduce(0);
  assert.deepEqual(store.readingPlan(0), { step:4, next:'2030-01-01' });
});

/* ---------- the four steps ---------- */

test('stepOf walks new -> started -> read -> known', async () => {
  assert.equal(srs.stepOf(0), 'new');
  await srs.introduce(0);
  assert.equal(srs.stepOf(0), 'started');
  await store.markReadCorrect(0);
  assert.equal(srs.stepOf(0), 'read');
  await seedWord(0, { box:4 });
  assert.equal(srs.stepOf(0), 'known');
});

test('box 4 is known whether or not the word was proved in a passage', async () => {
  await seedWord(0, { box:4 });
  assert.equal(srs.stepOf(0), 'known');
});

test('countStep and introducedIds count what the home screen shows', async () => {
  await srs.introduce(0); await srs.introduce(1); await srs.introduce(2);
  await store.markReadCorrect(1);
  await seedWord(2, { box:5 });
  assert.equal(srs.countStep('started'), 1);
  assert.equal(srs.countStep('read'), 1);
  assert.equal(srs.countStep('known'), 1);
  assert.deepEqual([...srs.introducedIds()].sort((a,b)=>a-b), [0,1,2]);
});

/* ---------- what is due ---------- */

test('due() returns words at or past their date and nothing else', async () => {
  await seedWord(0, { next: dateIn(1) });     // tomorrow
  await seedWord(1, { next: today() });       // today
  await seedWord(2, { next: daysAgo(9) });    // overdue
  assert.deepEqual(srs.due().sort((a,b)=>a-b), [1,2]);
});

/* ---------- the daily cap on new words ---------- */

test('the cap is five per rolling 24 hours', async () => {
  assert.equal(srs.newQuota(), 5);
  for(let id = 0; id < 5; id++) await srs.introduce(id);
  assert.equal(srs.newQuota(), 0);
  assert.ok(srs.unlockIn() > 0, 'with the cap full there must be a wait');
});

test('a word opened more than a day ago no longer counts against the cap', async () => {
  for(let id = 0; id < 5; id++) await seedWord(id, { new: hoursAgo(25) });
  assert.equal(srs.newQuota(), 5);
  assert.equal(srs.unlockIn(), 0);
});

test('unlockIn counts down to the oldest of the five, not to a flat 24 hours', async () => {
  for(let id = 0; id < 5; id++) await seedWord(id, { new: hoursAgo(23) });
  const hours = srs.unlockIn() / 36e5;
  assert.ok(hours > 0.5 && hours < 1.5, `expected about an hour, got ${hours}`);
});

test('+5 opens one more batch and does not raise the cap itself', async () => {
  for(let id = 0; id < 5; id++) await srs.introduce(id);
  assert.equal(srs.newQuota(), 0);
  await srs.grantMore();
  assert.equal(srs.newQuota(), 5, 'one grant is worth one batch of five');
  assert.equal(srs.unlockIn(), 0);
});

test('a grant ages out of the same rolling 24 hours, so tomorrow starts at five', async () => {
  await withClock(-25 * 36e5, () => srs.grantMore());     // asked for yesterday
  for(let id = 0; id < 5; id++) await srs.introduce(id);
  assert.equal(srs.newQuota(), 0, 'yesterday\'s grant must not still be open');
});

test('hhmm reads as a wait, not as milliseconds', () => {
  assert.equal(srs.hhmm(0), '0m');
  assert.equal(srs.hhmm(60e3), '1m');
  assert.equal(srs.hhmm(3.5 * 36e5), '3h 30m');
  assert.equal(srs.hhmm(24 * 36e5), '24h 0m');
});

/* ---------- grading a review ---------- */

test('the four grades move the box the way the buttons promise', async () => {
  const box = async g => { await fresh(); await seedWord(0, { box:1 }); await srs.grade(0, g);
                           return store.getWord(0).box; };
  assert.equal(await box(0), 0, 'Forgot: back to day one');
  assert.equal(await box(1), 1, 'Hard: same interval');
  assert.equal(await box(2), 2, 'Good: next interval');
  assert.equal(await box(3), 3, 'Easy: skip an interval');
});

test('grading sets the next date from the box and counts the answer', async () => {
  await seedWord(0, { box:0 });
  await srs.grade(0, 2);                                   // box 1 -> 3 days
  assert.equal(store.getWord(0).next, dateIn(3));
  assert.equal(store.getWord(0).seen, 1);
  assert.equal(store.getWord(0).right, 1);
  assert.deepEqual(store.todayLog(), { right:1, wrong:0 });
});

test('Forgot counts as wrong, comes back tomorrow, and is logged', async () => {
  await seedWord(0, { box:5 });
  await srs.grade(0, 0);
  assert.equal(store.getWord(0).box, 0);
  assert.equal(store.getWord(0).next, dateIn(1));
  assert.equal(store.getWord(0).wrong, 1);
  assert.deepEqual(store.todayLog(), { right:0, wrong:1 });
});

test('the box never runs past the last interval', async () => {
  await seedWord(0, { box:0 });
  for(let n = 0; n < 12; n++) await srs.grade(0, 3);
  assert.equal(store.getWord(0).box, 5, 'six intervals, so the last box is 5');
  assert.equal(store.getWord(0).next, dateIn(90));
});

test('grading a word that was never opened does not throw', async () => {
  await srs.grade(42, 2);
  assert.equal(store.getWord(42).box, 1);
});

/* ---------- the reading ladder ---------- */

test('answering from the text widens the gap, missing it goes back to day one', async () => {
  await srs.introduce(0);
  const steps = [];
  for(let n = 0; n < 8; n++){ await srs.gradeReading(0, true); steps.push(store.readingPlan(0).step); }
  assert.deepEqual(steps, [1,2,3,4,5,6,6,6], 'seven rungs, then it stays on the last');
  assert.equal(store.readingPlan(0).next, dateIn(180));

  await srs.gradeReading(0, false);
  assert.equal(store.readingPlan(0).step, 0);
  assert.equal(store.readingPlan(0).next, dateIn(1));
});

test('readingDue lists overdue words first', async () => {
  for(const id of [0,1,2]) await seedWord(id);
  await store.setReadingPlan(0, { step:0, next: daysAgo(1) });
  await store.setReadingPlan(1, { step:0, next: daysAgo(30) });
  await store.setReadingPlan(2, { step:0, next: dateIn(5) });
  assert.deepEqual(srs.readingDue(), [1,0], 'most overdue first, nothing that is not due');
});

test('nextReadingIn is the shortest wait, and null when something is already due', async () => {
  await seedWord(0); await seedWord(1);
  await store.setReadingPlan(0, { step:0, next: dateIn(9) });
  await store.setReadingPlan(1, { step:0, next: dateIn(4) });
  assert.equal(srs.nextReadingIn(), 4);
  await store.setReadingPlan(1, { step:0, next: today() });
  assert.equal(srs.nextReadingIn(), 9, 'a word already due is not a wait');
});

test('overdueBy is zero for a word that is not late', async () => {
  await seedWord(0);
  await store.setReadingPlan(0, { step:0, next: dateIn(3) });
  assert.equal(srs.overdueBy(0), 0);
  await store.setReadingPlan(0, { step:0, next: daysAgo(6) });
  assert.equal(srs.overdueBy(0), 6);
  assert.equal(srs.overdueBy(77), 0, 'a word with no plan is not overdue');
});

/* ---------- rule 14: reading only recolours a word ---------- */

test('reading never moves a review due date', async () => {
  await seedWord(0, { box:2, next: dateIn(7) });
  const before = { ...store.getWord(0) };

  await store.markPassageRead(11);
  await store.markReadCorrect(0);
  await srs.gradeReading(0, true);
  await srs.gradeReading(0, false);

  assert.deepEqual(store.getWord(0), before,
    'the review schedule is the review screen\'s job alone');
});

test('extra practice does not move the reading date either - only answering does', async () => {
  await srs.introduce(0);
  const plan = { ...store.readingPlan(0) };
  await store.markPassageRead(3);          // browsing the shelf
  assert.deepEqual(store.readingPlan(0), plan);
  await srs.gradeReading(0, true);         // answering its question
  assert.notDeepEqual(store.readingPlan(0), plan);
});

/* ---------- the familiarity index ---------- */

test('the three dots follow the word\'s actual journey', async () => {
  assert.deepEqual(srs.familiarity(0, 0), { level:0, cooling:false }, 'never opened');
  await srs.introduce(0);
  assert.equal(srs.familiarity(0, 0).level, 0, 'opened, but not met in a text');
  assert.equal(srs.familiarity(0, 1).level, 1, 'read inside a passage');
  await store.markReadCorrect(0);
  assert.equal(srs.familiarity(0, 1).level, 2, 'answered from the passage');
  await seedWord(0, { box:4 });
  assert.equal(srs.familiarity(0, 1).level, 3, 'box 4 and proved in context');
});

test('box 4 alone is not mastery - the word still has to be proved in a text', async () => {
  await seedWord(0, { box:5 });
  assert.equal(srs.familiarity(0, 1).level, 1);
});

test('the last dot cools only when the word is well past its turn', async () => {
  await seedWord(0);
  await store.markReadCorrect(0);
  await store.setReadingPlan(0, { step:0, next: daysAgo(1) });   // one day late, slack 1
  assert.equal(srs.familiarity(0, 1).cooling, false);
  await store.setReadingPlan(0, { step:0, next: daysAgo(3) });
  assert.equal(srs.familiarity(0, 1).cooling, true);
});

test('a word at level 0 never cools - there is nothing lit to fade', async () => {
  await seedWord(0);
  await store.setReadingPlan(0, { step:0, next: daysAgo(400) });
  assert.deepEqual(srs.familiarity(0, 0), { level:0, cooling:false });
});

test('STEP_NAME covers every step the review screen can show', () => {
  for(const step of ['started','read','known']) assert.ok(srs.STEP_NAME[step]);
});

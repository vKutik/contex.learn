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
import { DAILY_BUDGET } from '../../js/data.js';

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

/* ---------- the daily budget ---------- */

test('with nothing answered yet, budgetLeft is the whole daily budget', () => {
  assert.equal(srs.budgetLeft(), DAILY_BUDGET);
});

test('the budget counts every answer logged today, right and wrong alike', async () => {
  await store.logAnswer(true);
  await store.logAnswer(true);
  await store.logAnswer(false);
  assert.equal(srs.budgetLeft(), DAILY_BUDGET - 3);
});

test('budgetLeft never goes below zero', async () => {
  for(let n = 0; n < DAILY_BUDGET + 5; n++) await store.logAnswer(true);
  assert.equal(srs.budgetLeft(), 0);
});

test('dueSorted puts a 9-days-overdue word ahead of a due-today one', async () => {
  await seedWord(0, { next: today(), box: 0 });
  await seedWord(1, { next: daysAgo(9), box: 0 });
  assert.deepEqual(srs.dueSorted(), [1, 0]);
});

test('dueSorted breaks ties by the lower box first', async () => {
  await seedWord(0, { next: daysAgo(2), box: 3 });
  await seedWord(1, { next: daysAgo(2), box: 1 });
  assert.deepEqual(srs.dueSorted(), [1, 0]);
});

test('reviewQueue is cut to the budget when more is due than fits', async () => {
  for(let id = 0; id < 5; id++) await seedWord(id, { next: daysAgo(1), box: 0 });
  for(let n = 0; n < DAILY_BUDGET - 2; n++) await store.logAnswer(true);   // 2 left
  assert.equal(srs.budgetLeft(), 2);
  assert.equal(srs.dueSorted().length, 5);
  assert.deepEqual(srs.reviewQueue(), srs.dueSorted().slice(0, 2));
  assert.equal(srs.reviewQueue().length, 2);
});

test('a word cut from today\'s queue is still due tomorrow', async () => {
  await seedWord(0, { next: daysAgo(1), box: 0 });
  await seedWord(1, { next: daysAgo(1), box: 0 });
  for(let n = 0; n < DAILY_BUDGET - 1; n++) await store.logAnswer(true);   // 1 left
  assert.equal(srs.reviewQueue().length, 1);
  assert.equal(srs.due().length, 2, 'the cut word is still due, budget or not');
});

/* ---------- the daily cap on new words ---------- */

test('the cap is five per rolling twelve hours', async () => {
  assert.equal(srs.newQuota(), 5);
  for(let id = 0; id < 5; id++) await srs.introduce(id);
  assert.equal(srs.newQuota(), 0);
  assert.ok(srs.unlockIn() > 0, 'with the cap full there must be a wait');
});

test('a word opened more than twelve hours ago no longer counts against the cap', async () => {
  for(let id = 0; id < 5; id++) await seedWord(id, { new: hoursAgo(13) });
  assert.equal(srs.newQuota(), 5);
  assert.equal(srs.unlockIn(), 0);
});

test('unlockIn counts down to the oldest of the five, not to a flat 12 hours', async () => {
  for(let id = 0; id < 5; id++) await seedWord(id, { new: hoursAgo(11) });
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

test('a grant ages out of the same rolling window an opened word does', async () => {
  await withClock(-13 * 36e5, () => srs.grantMore());     // asked for 13 hours ago
  for(let id = 0; id < 5; id++) await srs.introduce(id);
  assert.equal(srs.newQuota(), 0, 'a grant from 13 hours ago must not still be open');
});

test('a grant made inside the last 12 hours still opens a batch', async () => {
  await withClock(-11 * 36e5, () => srs.grantMore());     // asked for 11 hours ago
  for(let id = 0; id < 5; id++) await srs.introduce(id);
  assert.equal(srs.newQuota(), 5, 'an 11-hour-old grant is still inside the window');
});

/* ---------- the backlog brake on new words ---------- */

test('with no backlog, newQuota behaves as before: five, then zero', async () => {
  assert.equal(srs.newQuota(), 5);
  for(let id = 0; id < 5; id++) await srs.introduce(id);
  assert.equal(srs.newQuota(), 0);
});

test('a backlog bigger than the budget blocks new words even with an empty window', async () => {
  for(let n = 0; n < DAILY_BUDGET - 2; n++) await store.logAnswer(true);   // budgetLeft = 2
  for(let id = 0; id < 3; id++) await seedWord(id, { next: daysAgo(1) });  // 3 due
  assert.equal(srs.newQuota(), 0, 'the window is empty but there is no room left for new words');
});

test('grantMore does not get past the backlog brake - it only lifts byWindow', async () => {
  for(let n = 0; n < DAILY_BUDGET - 2; n++) await store.logAnswer(true);   // budgetLeft = 2
  for(let id = 0; id < 3; id++) await seedWord(id, { next: daysAgo(1) });  // 3 due
  await srs.grantMore();
  assert.equal(srs.newQuota(), 0, 'the grant raises the window cap, not the space the budget has left');
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

/* ---------- a word forgotten earlier in the same sitting ---------- */

test('a word forgotten in this sitting stays in box 0 and is due tomorrow, however easy it felt', async () => {
  for(const g of [1, 2, 3]){
    await fresh();
    await seedWord(0, { box:3, right:4 });
    await srs.grade(0, 0);                                  // forgotten: box 0
    await srs.grade(0, g, { repeat:true });                 // shown again ~40 s later
    assert.equal(store.getWord(0).box, 0, `grade ${g} on a repeat lifted it to box ${store.getWord(0).box}`);
    assert.equal(store.getWord(0).next, dateIn(1), 'box 1 would be three days away - tomorrow instead');
  }
});

test('one lapse is counted once: a repeat in the same sitting adds no wrong and no tally', async () => {
  await seedWord(0, { box:2, right:2 });
  await srs.grade(0, 0);                                    // the real miss
  await srs.grade(0, 0, { repeat:true });                   // tapped through again seconds later
  assert.equal(store.getWord(0).wrong, 1);
  assert.deepEqual(store.todayLog(), { right:0, wrong:1 });
  await srs.grade(0, 2, { repeat:true });                   // practice, not evidence
  assert.equal(store.getWord(0).right, 2);
  assert.deepEqual(store.todayLog(), { right:0, wrong:1 });
  assert.equal(store.getWord(0).seen, 3, 'every showing is still a showing');
});

test('a word missed more often than answered right climbs one box at a time', async () => {
  await seedWord(0, { box:0, right:2, wrong:6 });           // the record the log showed for "bare"
  await srs.grade(0, 3);
  assert.equal(store.getWord(0).box, 1, 'Easy on a word with six lapses is box 1, not box 2');
  assert.equal(store.getWord(0).next, dateIn(3));
  await seedWord(1, { box:2, right:3, wrong:4 });
  await srs.grade(1, 2);
  assert.equal(store.getWord(1).box, 3, 'Good still moves it one box');
  await seedWord(2, { box:1, right:3, wrong:3 });
  await srs.grade(2, 3);
  assert.equal(store.getWord(2).box, 3, 'as many right as wrong: Easy skips an interval again');
});

test('normal promotion resumes in the next sitting', async () => {
  await seedWord(0, { box:1, right:3, wrong:1 });
  await srs.grade(0, 3);                                    // a new sitting: no repeat flag
  assert.equal(store.getWord(0).box, 3);
});

/* ---------- the lesson's recall step ---------- */

test('a recall answer is counted on the word but moves neither its box nor its date', async () => {
  await srs.introduce(75);
  await srs.recallAnswer(75, false);
  let w = store.getWord(75);
  assert.deepEqual([w.seen, w.right, w.wrong, w.box, w.next], [1, 0, 1, 0, dateIn(1)]);
  assert.deepEqual(store.todayLog(), { right:0, wrong:1 });
  await srs.introduce(77);
  await srs.recallAnswer(77, true);
  w = store.getWord(77);
  assert.deepEqual([w.seen, w.right, w.wrong, w.box], [1, 1, 0, 0]);
});

test('a word missed in recall climbs to box 1 at most on its first review', async () => {
  await srs.introduce(0);
  await srs.recallAnswer(0, false);
  await srs.grade(0, 3);
  assert.equal(store.getWord(0).box, 1, 'Easy after a recall miss is box 1');
  await srs.grade(0, 3);
  assert.equal(store.getWord(0).box, 3, 'from there it climbs normally');

  await srs.introduce(1);
  await srs.recallAnswer(1, true);
  await srs.grade(1, 3);
  assert.equal(store.getWord(1).box, 2, 'a word recalled right is not held back');
});

test('unsettledCount counts the words still in box 0, and nothing else', async () => {
  for(let id = 0; id < 12; id++) await seedWord(id, { box: id < 11 ? 0 : 1 });
  assert.equal(srs.unsettledCount(), 11);
  assert.ok(srs.unsettledCount() > srs.BACKLOG_LIMIT, 'eleven is over the default limit of ten');
});

test('a word becomes a leech at LEECH_AT misses, not before', async () => {
  await seedWord(0, { wrong: srs.LEECH_AT - 1 });
  assert.equal(srs.isLeech(0), false);
  await srs.grade(0, 0);
  assert.equal(srs.isLeech(0), true);
  assert.equal(srs.isLeech(99), false, 'a word never opened is not a leech');
});

test('tricky is a state: box 3 clears it, dropping below box 3 brings it back', async () => {
  await seedWord(0, { wrong:6, box:1 });
  assert.equal(srs.isLeech(0), true, 'wrong 6, box 1: tricky');
  await seedWord(0, { wrong:6, box: srs.LEECH_CLEAR_BOX });
  assert.equal(srs.isLeech(0), false, 'wrong 6, box 3: known well enough, the tag clears');
  await srs.grade(0, 0);                                    // forgotten again: box 0
  assert.equal(store.getWord(0).box, 0);
  assert.equal(srs.isLeech(0), true, 'back below box 3: tricky again');
});

/* ---------- which cloze card a tricky word gets ---------- */

const cards = ['9:3','9:0','9:1','9:2','9:4'].map(id => ({ id }));

test('trickyCard: a card never met comes first', () => {
  assert.equal(srs.trickyCard(cards, ['9:3','9:0'], {}).id, '9:1');
});

test('trickyCard: all met, the worst record wins - but never the card met last', () => {
  const seen = ['9:3','9:0','9:1','9:2','9:4'];               // 9:4 met last
  const stats = {
    '9:3': { shown:4, wrong:1 }, '9:0': { shown:2, wrong:0 }, '9:1': { shown:3, wrong:2 },
    '9:2': { shown:5, wrong:1 }, '9:4': { shown:2, wrong:2 }   // worst of all, but just failed
  };
  assert.equal(srs.trickyCard(cards, seen, stats).id, '9:1', '2 of 3 missed, and not the last one');
  assert.equal(srs.trickyCard(cards, ['9:0','9:1','9:2','9:4','9:3'], stats).id, '9:4',
    'once another card was met after it, the worst is fair game again');
});

test('trickyCard: equal records go to the card met longest ago; one card is still a card', () => {
  assert.equal(srs.trickyCard(cards, ['9:2','9:3','9:0','9:1','9:4'], {}).id, '9:2');
  assert.equal(srs.trickyCard([{ id:'9:3' }], ['9:3'], {}).id, '9:3');
  assert.equal(srs.trickyCard([], [], {}), null);
});

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
  for(const id of [0,1,2]) await seedWord(id, { box:2 });
  await store.setReadingPlan(0, { step:0, next: daysAgo(1) });
  await store.setReadingPlan(1, { step:0, next: daysAgo(30) });
  await store.setReadingPlan(2, { step:0, next: dateIn(5) });
  assert.deepEqual(srs.readingDue(), [1,0], 'most overdue first, nothing that is not due');
});

test('readingOrder lists every planned word, closest to its turn first', async () => {
  // what "Another word" walks when reading ahead: with nothing overdue, every
  // word used to tie at zero days late and the walk bounced between two
  for(const id of [0,1,2,3]) await seedWord(id);
  await store.setReadingPlan(0, { step:2, next: dateIn(9) });
  await store.setReadingPlan(1, { step:1, next: dateIn(2) });
  await store.setReadingPlan(2, { step:0, next: daysAgo(3) });
  await store.setReadingPlan(3, { step:1, next: dateIn(2) });
  assert.deepEqual(srs.readingOrder(), [2,1,3,0], 'overdue, then soonest; ties by id');
});

test('readingDue asks only for words that reached box 2', async () => {
  for(const id of [0,1,2,3]) await seedWord(id, { box: id });
  for(const id of [0,1,2,3]) await store.setReadingPlan(id, { step:0, next: daysAgo(1) });
  assert.deepEqual(srs.readingDue(), [2,3], 'box 0 and 1 are still learning from the card');
});

test('readingDue asks for three texts a day at most, and reading any text uses one up', async () => {
  for(let id = 0; id < 8; id++){
    await seedWord(id, { box:2 });
    await store.setReadingPlan(id, { step:0, next: daysAgo(8 - id) });
  }
  assert.equal(srs.READ_DAILY, 3);
  assert.deepEqual(srs.readingDue(), [0,1,2], 'the three most overdue, not all eight');
  await srs.gradeReading(0, true);
  assert.deepEqual(srs.readingDue(), [1,2]);
  await srs.gradeReading(7, false);                        // read ahead of its turn: still a text today
  assert.deepEqual(srs.readingDue(), [1]);
  await srs.gradeReading(1, true);
  assert.deepEqual(srs.readingDue(), [], 'three today: the schedule has finished asking');
  assert.equal(srs.readsLeftToday(), 0);
});

test('a text graded on an earlier day does not count against today', async () => {
  await seedWord(0, { box:2 });
  await store.setReadingPlan(0, { step:1, next: daysAgo(1), at: daysAgo(3) });
  assert.equal(srs.readsLeftToday(), srs.READ_DAILY);
  assert.deepEqual(srs.readingDue(), [0]);
});

test('nextReadingIn is the shortest wait, and null when something is already due', async () => {
  await seedWord(0, { box:2 }); await seedWord(1, { box:2 }); await seedWord(2, { box:1 });
  await store.setReadingPlan(2, { step:0, next: dateIn(1) });  // not settled: not a wait either
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

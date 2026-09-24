/* telemetry.js and the usage log in storage.js.
 *
 * The log is only worth keeping if two things hold: it never changes what
 * the learner is taught, and what it says can be trusted when it is read
 * back. The first half is checked against the progress snapshot, the second
 * against summarize(), which is what the developer card and any later
 * analysis read.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../../js/storage.js';
import * as srs from '../../js/srs.js';
import { track, summarize } from '../../js/telemetry.js';
import { BUILD } from '../../js/build.js';
import { fresh, seedWord, daysAgo } from '../helpers/fixture.mjs';

beforeEach(async () => { await fresh(); store.clearEvents(); });

test('an event is stamped with its time, its sitting and its build', () => {
  const before = Date.now();
  track('answer', { w: 3, ok: false, ms: 1200 });
  const [ev] = store.eventLog();
  assert.equal(ev.e, 'answer');
  assert.equal(ev.b, BUILD);
  assert.ok(ev.t >= before && ev.t <= Date.now());
  assert.match(ev.s, /^[a-z0-9]+$/);
  assert.deepEqual({ w: ev.w, ok: ev.ok, ms: ev.ms }, { w: 3, ok: false, ms: 1200 });
});

test('logging changes no progress - no due date, no box, no daily tally', async () => {
  await seedWord(4, { box: 2 });
  const before = JSON.stringify(store.snapshot());
  track('answer', { w: 4, ok: false });
  track('grade', { w: 4, g: 0 });
  track('peek', { w: 4, p: 40 });
  assert.equal(JSON.stringify(store.snapshot()), before);
});

test('the log is capped, and it is the oldest events that go', () => {
  for(let i = 0; i < 3100; i++) track('say', { w: i });
  const log = store.eventLog();
  assert.equal(log.length, 3000);
  assert.equal(log[0].w, 100, 'the first hundred should have been dropped');
  assert.equal(log.at(-1).w, 3099);
});

test('a progress reset keeps the log; clearing the log keeps the progress', async () => {
  await seedWord(1);
  track('reset');
  await store.resetAll();
  assert.equal(store.eventLog().length, 1, 'a reset is something that happened, not a reason to forget');
  await seedWord(2);
  store.clearEvents();
  assert.equal(store.eventLog().length, 0);
  assert.ok(store.getWord(2), 'clearing the log must not touch progress');
});

test('every install gets one anonymous id, and it is stable', () => {
  const id = store.installId();
  assert.match(id, /^[0-9a-z-]{8,}$/i);
  assert.equal(store.installId(), id);
});

test('reviewContext says what a grade was measured against, before the grade moves it', async () => {
  await seedWord(6, { box: 2, lastSeen: daysAgo(9), next: daysAgo(2) });
  assert.deepEqual(srs.reviewContext(6), { box: 2, elapsed: 9, overdue: 2 });
  await srs.grade(6, 2);
  assert.deepEqual(srs.reviewContext(6), { box: 3, elapsed: 0, overdue: 0 });
  assert.deepEqual(srs.reviewContext(99), { box: 0, elapsed: null, overdue: 0 });
});

/* ---------- summarize ---------- */
const ev = (e, fields = {}, s = 'a') => ({ t: 1, s, b: 'x', e, ...fields });

test('the funnel counts distinct lessons at each stage, not visits', () => {
  const x = summarize([
    ev('screen', { name:'lesson', l:1, st:0 }), ev('screen', { name:'lesson', l:1, st:0 }),
    ev('screen', { name:'lesson', l:2, st:0 }),
    ev('screen', { name:'lesson', l:1, st:1 }), ev('screen', { name:'lesson', l:2, st:1 }),
    ev('screen', { name:'lesson', l:1, st:2 }),
    ev('screen', { name:'lesson', l:1, st:3 }),
    ev('lesson_done', { l:1 }),
    ev('screen', { name:'home' })
  ]);
  assert.deepEqual(x.funnel.map(f => [f.stage, f.n]),
    [['cards',2], ['recall',2], ['reading',1], ['quiz',1], ['done',1]]);
});

test('answers are split by mechanic with their accuracy and median time', () => {
  const x = summarize([
    ev('answer', { k:'gap', ok:true,  ms:1000 }), ev('answer', { k:'gap', ok:false, ms:3000 }),
    ev('answer', { k:'gap', ok:true,  ms:2000 }), ev('answer', { k:'focus', ok:true, ms:800 })
  ]);
  assert.deepEqual(x.mech, [{ k:'gap', n:3, ok:2, ms:2000 }, { k:'focus', n:1, ok:1, ms:800 }]);
});

test('hardest words need enough answers to say so, and count forgotten grades as misses', () => {
  const x = summarize([
    ev('answer', { w:1, ok:false }), ev('answer', { w:1, ok:false }), ev('grade', { w:1, g:0 }),
    ev('answer', { w:2, ok:false }), ev('answer', { w:2, ok:true }),  ev('grade', { w:2, g:2 }),
    ev('answer', { w:3, ok:false })                                    // one answer: not enough
  ]);
  assert.deepEqual(x.words.map(r => [r.w, r.miss, r.n]), [[1,3,3], [2,1,3]]);
});

test('hardest texts put missed checks first, then tooltip lookups', () => {
  const x = summarize([
    ev('answer', { p:10, w:1, ok:true }), ev('peek', { p:10, w:1 }), ev('peek', { p:10, w:1 }),
    ev('answer', { p:20, w:2, ok:false }),
    ev('answer', { p:30, w:3, ok:true })                              // clean: not listed
  ]);
  assert.deepEqual(x.passages.map(r => r.p), [20, 10]);
  assert.deepEqual(x.passages[1], { p:10, n:1, miss:0, peek:2 });
});

test('it counts sittings, where the tab was left, and shows the latest errors first', () => {
  const x = summarize([
    ev('leave', { screen:'lesson' }, 'a'), ev('leave', { screen:'lesson' }, 'b'),
    ev('leave', { screen:'home' }, 'b'),
    ev('error', { msg:'one' }, 'b'), ev('error', { msg:'two' }, 'b')
  ]);
  assert.equal(x.sessions, 2);
  assert.deepEqual(x.exits, [{ screen:'lesson', n:2 }, { screen:'home', n:1 }]);
  assert.deepEqual(x.errors.map(e => e.msg), ['two', 'one']);
});

test('an empty log summarizes to zeros rather than throwing', () => {
  const x = summarize([]);
  assert.equal(x.events, 0);
  assert.equal(x.since, null);
  assert.deepEqual(x.mech, []);
  assert.ok(x.funnel.every(f => f.n === 0));
});

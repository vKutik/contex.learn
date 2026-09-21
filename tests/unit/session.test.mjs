/* session.js - turns a day's capped review queue into mini-sittings of five,
 * with one soft second chance for a card just missed. Pure: no DOM, no
 * storage - it only ever sees ids and booleans the caller already has.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startSession, afterAnswer, sessionLabel } from '../../js/session.js';
import { SESSION_SIZE } from '../../js/data.js';

/* ---------- starting a sitting ---------- */

test('startSession never hands back more than SESSION_SIZE cards', () => {
  const due = Array.from({ length: 20 }, (_, i) => i);
  assert.equal(startSession(due).length, SESSION_SIZE);
});

test('startSession takes the front of the queue - the most overdue, unshuffled', () => {
  const due = [7, 3, 9, 1, 5, 2, 8];
  assert.deepEqual(startSession(due).map(e => e.id), [7, 3, 9, 1, 5]);
});

test('startSession hands back fewer than SESSION_SIZE when fewer are due', () => {
  assert.equal(startSession([1, 2, 3]).length, 3);
  assert.deepEqual(startSession([]), []);
});

test('every entry starts as a first turn, not a relearn turn', () => {
  for(const e of startSession([1, 2, 3])) assert.equal(e.relearn, false);
});

/* ---------- a wrong answer's second turn ---------- */

test('a card missed for the first time is queued once more at the end', () => {
  const session = startSession([1, 2, 3]);
  const missed = session[0];
  const queue = afterAnswer(session, missed, false);
  assert.equal(queue.length, 4);
  assert.deepEqual(queue[3], { id: missed.id, relearn: true });
});

test('a correct answer does not requeue the card', () => {
  const session = startSession([1, 2, 3]);
  const queue = afterAnswer(session, session[0], true);
  assert.equal(queue.length, 3);
});

test('a card never appears a third time - missing its relearn turn does not requeue it again', () => {
  let queue = startSession([1]);
  queue = afterAnswer(queue, queue[0], false);          // first miss: one more turn
  assert.equal(queue.length, 2);
  queue = afterAnswer(queue, queue[1], false);          // missed the relearn turn too
  assert.equal(queue.length, 2, 'no third turn, whatever the relearn turn scores');
});

test('getting the relearn turn right does not add a further turn either', () => {
  let queue = startSession([1]);
  queue = afterAnswer(queue, queue[0], false);
  queue = afterAnswer(queue, queue[1], true);
  assert.equal(queue.length, 2);
});

/* ---------- the progress label ---------- */

test('sessionLabel reads "N of 5" while working through a full sitting', () => {
  const queue = startSession([1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(sessionLabel(0, queue), { index: 1, total: 5 });
  assert.deepEqual(sessionLabel(4, queue), { index: 5, total: 5 });
});

test('sessionLabel reads "N of M" when fewer than SESSION_SIZE are due', () => {
  const queue = startSession([1, 2, 3]);
  assert.deepEqual(sessionLabel(1, queue), { index: 2, total: 3 });
});

test('sessionLabel holds at the sitting size while a relearn turn plays - it is not "the 5"', () => {
  let queue = startSession([1, 2, 3, 4, 5]);
  queue = afterAnswer(queue, queue[0], false);   // 6 entries now, but still a sitting of 5
  assert.equal(queue.length, 6);
  assert.deepEqual(sessionLabel(5, queue), { index: 5, total: 5 },
    'the relearn turn reads as the last of the five, not a sixth card');
});

/* session.js - turns a day's capped review queue into mini-sittings of five,
 * with one soft second chance for a card just missed. No DOM, no storage:
 * it only ever works on the ids and grades app.js already has, so the
 * scheduling this builds on top of - srs.js - can move to a server
 * untouched, and this can be tested the same way.
 */
import { SESSION_SIZE } from './data.js';

/** The next sitting: the front of today's queue, already most-overdue-first
 *  - never more than SESSION_SIZE, fewer when fewer are due. */
export function startSession(dueIds){
  return dueIds.slice(0, SESSION_SIZE).map(id => ({ id, relearn:false }));
}

/** What the rest of the sitting looks like after grading one entry. A card
 *  missed on its first turn gets one more turn at the end of this same
 *  sitting; a card already on its second turn never comes back a third
 *  time, whatever it scores. */
export function afterAnswer(queue, entry, correct){
  if(correct || entry.relearn) return queue;
  return [...queue, { id: entry.id, relearn:true }];
}

/** "3 of 5": counts only the sitting's own cards, holding at that total
 *  while a relearn turn plays out at the end - a repeat is not "the 5",
 *  and the day's full due count never has to appear on this screen. */
export function sessionLabel(index, queue){
  const total = queue.filter(e => !e.relearn).length;
  return { index: Math.min(index, total - 1) + 1, total };
}

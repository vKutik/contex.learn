/* srs.js - the scheduling rules. No DOM, no storage internals: it reads a
 * snapshot and writes back through storage.js, so the same logic can move to
 * a Python service untouched.
 */
import { DAILY_NEW_LIMIT, NEW_WINDOW_MS, DAILY_BUDGET } from './data.js';
import * as store from './storage.js';

/** Review intervals in days. The spacing is the part that does the work. */
const STEPS = [1, 3, 7, 16, 35, 90];
const DAY = 864e5;

const today = () => new Date().toISOString().slice(0,10);
const daysBetween = (a,b) => Math.round((new Date(b) - new Date(a)) / DAY);

/** A date n days from today, as the YYYY-MM-DD both schedules store. */
const addDays = n => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0,10);
};

/* ---------- the four steps a word moves through ----------
 *   new     never opened                       grey
 *   started its first flashcard is done        red
 *   read    proved inside a passage            amber
 *   known   box 4, the interval is months      green
 * Reading only recolours a word; it never moves its due date.
 */
export const STEP_NAME = { started:'Started', read:'Seen', known:'Learned' };

export function stepOf(id){
  const s = store.getWord(id);
  if(!s) return 'new';
  if(s.box >= 4) return 'known';
  return store.isReadProven(id) ? 'read' : 'started';
}

export const countStep = step =>
  Object.keys(store.snapshot().words).filter(id => stepOf(+id) === step).length;

/** Ids of every word already introduced - what unlocks reading. */
export const introducedIds = () => new Set(Object.keys(store.snapshot().words).map(Number));

/* ---------- what is due ---------- */
export function due(){
  const t = today();
  return Object.keys(store.snapshot().words)
    .filter(id => daysBetween(store.getWord(id).next, t) >= 0)
    .map(Number);
}

/* ---------- the daily budget on total work ---------- */

/** Every answer logged today - card reviews, lesson quiz questions and
 *  reading checks alike. The budget measures work done, not cards alone. */
export const doneToday = () => {
  const log = store.todayLog();
  return log.right + log.wrong;
};

export const budgetLeft = () => Math.max(0, DAILY_BUDGET - doneToday());

/** due(), most overdue first; ties broken by the lower box - the word with
 *  more riding on it comes first when two are equally late. */
export function dueSorted(){
  const t = today();
  return due().sort((a, b) => {
    const overdue = daysBetween(store.getWord(b).next, t) - daysBetween(store.getWord(a).next, t);
    return overdue || store.getWord(a).box - store.getWord(b).box;
  });
}

/** What today's budget actually has room for. Extra practice never moves a
 *  due date - a word cut here is still in due() tomorrow, at the front. */
export const reviewQueue = () => dueSorted().slice(0, budgetLeft());

/* ---------- the daily cap on new words ---------- */
const startTimes = () => {
  const now = Date.now();
  return Object.keys(store.snapshot().words)
    .map(id => store.getWord(id).new)
    .filter(t => t && now - t < NEW_WINDOW_MS)
    .sort((a,b) => a-b);
};

/** The cap as it stands this minute: five, plus any batch asked for inside
 *  the last 12 hours. Both halves age out of the same rolling window. */
const capNow = () => DAILY_NEW_LIMIT + store.grantsSince(Date.now() - NEW_WINDOW_MS) * DAILY_NEW_LIMIT;

/** The window brake and the budget brake, whichever bites first: opening a
 *  word this cap allows still has to fit inside what today has room for. */
export const newQuota = () => {
  const byWindow = capNow() - startTimes().length;
  const bySpace  = budgetLeft() - due().length;
  return Math.max(0, Math.min(byWindow, bySpace));
};

/** Open one more batch of five right now, without moving the cap itself. */
export const grantMore = () => store.grantNewWords();

/** Milliseconds until the cap frees up again, 0 if it already has. */
export function unlockIn(){
  const r = startTimes(), cap = capNow();
  if(r.length < cap) return 0;
  return Math.max(0, r[r.length - cap] + NEW_WINDOW_MS - Date.now());
}

export function hhmm(ms){
  const m = Math.ceil(ms/6e4), h = Math.floor(m/60);
  return h ? `${h}h ${m%60}m` : `${m}m`;
}

/* ---------- transitions ---------- */
export function introduce(id){
  const s = store.getWord(id) || { box:0, right:0, wrong:0, seen:0 };
  if(!s.new) s.new = Date.now();
  s.next = addDays(STEPS[0]);
  s.lastSeen = today();
  // the lesson was the first meeting; the first text is offered straight away,
  // and only then do the intervals start growing
  if(!store.readingPlan(id)) store.setReadingPlan(id, { step:0, next: today() });
  return store.putWord(id, s);
}

/** grade: 0 forgot, 1 hard, 2 good, 3 easy. */
export function grade(id, g){
  const s = store.getWord(id) || { box:0, right:0, wrong:0, seen:0 };
  s.seen++;
  if(g === 0){ s.wrong++; s.box = 0; }                 // forgot: back to day one
  else { s.right++; s.box = Math.min(STEPS.length-1, s.box + (g === 1 ? 0 : g === 2 ? 1 : 2)); }
  s.next = addDays(STEPS[s.box]);
  s.lastSeen = today();
  store.logAnswer(g > 0);
  return store.putWord(id, s);
}

/* ================= reading on a growing interval =================
 *
 * Ebbinghaus, applied to context rather than to cards: a word comes back in
 * a *different* text each time, and the gap widens with every success -
 * a day, then three, a week, a fortnight, a month, three months, half a year.
 * Miss it and the word drops to the start of the ladder, which is what makes
 * the schedule honest rather than decorative.
 */
const READ_STEPS = [1, 3, 7, 16, 35, 90, 180];

/** Words whose next text is due today or overdue, most overdue first. */
export function readingDue(){
  const t = today();
  return [...introducedIds()]
    .filter(id => {
      const plan = store.readingPlan(id);
      return plan && daysBetween(plan.next, t) >= 0;
    })
    .sort((a,b) => daysBetween(store.readingPlan(b).next, t)
                 - daysBetween(store.readingPlan(a).next, t));
}

/** How long until the next word is due a text, in days; null if none waiting. */
export function nextReadingIn(){
  const t = today();
  const waits = [...introducedIds()]
    .map(id => store.readingPlan(id))
    .filter(Boolean)
    .map(plan => -daysBetween(plan.next, t))
    .filter(d => d > 0);
  return waits.length ? Math.min(...waits) : null;
}

/** Answered from the text: widen the gap. Missed it: back to the first rung. */
export function gradeReading(id, ok){
  const plan = store.readingPlan(id) || { step:0, next: today() };
  const step = ok ? Math.min(READ_STEPS.length - 1, plan.step + 1) : 0;
  return store.setReadingPlan(id, { step, next: addDays(READ_STEPS[step]) });
}

/** Days a word is overdue for its next text, 0 when it is not. */
export function overdueBy(id){
  const plan = store.readingPlan(id);
  if(!plan) return 0;
  return Math.max(0, daysBetween(plan.next, today()));
}

/* ================= the familiarity index =================
 *
 * Three dots, not a percentage: how far you and this word have got.
 *   0  never met it in a text
 *   1  read it once inside a real passage
 *   2  answered for it correctly from that passage
 *   3  mastered - months between reviews, and proven in context
 *
 * `cooling` is the forgetting curve showing through: leave a word long past
 * its due date and the last lit dot fades, as a nudge rather than a penalty.
 */
export function familiarity(id, textsRead = 0){
  const w = store.getWord(id);
  if(!w) return { level: 0, cooling: false };

  let level = textsRead > 0 ? 1 : 0;
  if(store.isReadProven(id)) level = 2;
  if(w.box >= 4 && store.isReadProven(id)) level = 3;

  const plan = store.readingPlan(id);
  const slack = plan ? READ_STEPS[plan.step] : 1;
  const cooling = level > 0 && overdueBy(id) > slack;   // well past its turn
  return { level, cooling };
}

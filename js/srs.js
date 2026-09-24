/* srs.js - the scheduling rules. No DOM, no storage internals: it reads a
 * snapshot and writes back through storage.js, so the same logic can move to
 * a Python service untouched.
 */
import { DAILY_NEW_LIMIT, NEW_WINDOW_MS, DAILY_BUDGET, cloze } from './data.js';
import * as store from './storage.js';
import { dayKey } from './util.js';

/** Review intervals in days. The spacing is the part that does the work. */
const STEPS = [1, 3, 7, 16, 35, 90];
/** The box whose interval is counted in months: a word here is known. */
const KNOWN_BOX = 4;
/** The highest box a word can reach on a success that follows a miss - in
 *  the same sitting, or with no right answer ever to set against it. */
const RELEARN_BOX = 1;
const DAY = 864e5;

const today = () => dayKey();
/** Whole days from one YYYY-MM-DD to another; both parse as UTC midnight,
 *  so the difference is exact whatever the learner's time zone. */
const daysBetween = (a,b) => Math.round((new Date(b) - new Date(a)) / DAY);

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
  if(s.box >= KNOWN_BOX) return 'known';
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
const doneToday = () => {
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

/** More words than this still in box 0 and the home screen asks "review
 *  first?" before a new lesson - it still lets you, it just asks. */
export const BACKLOG_LIMIT = 10;
/** Words opened but not yet past their first interval. */
export const unsettledCount = () =>
  Object.values(store.snapshot().words).filter(w => w.box === 0).length;

/** Missed this many times in all, a word is a leech: the card is not
 *  working for it, so the review asks for its meaning instead of the same
 *  cloze, and the word list marks it. */
export const LEECH_AT = 5;
export const isLeech = id => (store.getWord(id)?.wrong || 0) >= LEECH_AT;

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
  s.next = dayKey(STEPS[0]);
  s.lastSeen = today();
  // the lesson was the first meeting; the first text is offered straight away,
  // and only then do the intervals start growing
  if(!store.readingPlan(id)) store.setReadingPlan(id, { step:0, next: today() });
  return store.putWord(id, s);
}

/** What a grade is about to be measured against: the box, the days since the
 *  word was last seen, and how late it came back. Read *before* grade(), so
 *  the usage log can say whether an interval was too long - which is the
 *  question the whole of STEPS rests on. */
export function reviewContext(id){
  const s = store.getWord(id);
  if(!s) return { box:0, elapsed:null, overdue:0 };
  const t = today();
  return { box: s.box,
           elapsed: s.lastSeen ? daysBetween(s.lastSeen, t) : null,
           overdue: s.next ? Math.max(0, daysBetween(s.next, t)) : 0 };
}

/**
 * What one grade does to a word's record - pure, so the rules can be tested
 * without storage. Returns the new record and what goes into today's tally
 * (true right, false wrong, null nothing).
 *
 *  - `repeat`: the word was already forgotten earlier in this sitting. The
 *    answer is practice, not evidence: it counts towards neither `right` nor
 *    `wrong` nor today's tally - one lapse is one lapse, however many times
 *    the sitting shows it again - and a success lifts the word to box 1 at
 *    most, since remembering it forty seconds after being shown it proves
 *    nothing about next week. Normal promotion resumes in the next sitting.
 *  - a word that has been missed and never yet answered right - a miss in
 *    the lesson's recall counts - climbs at most to box 1 on its first
 *    success: its first review is where it is learned, not where it is
 *    confirmed.
 *
 * grade: 0 forgot, 1 hard, 2 good, 3 easy.
 */
function applyGrade(rec, g, { repeat = false } = {}){
  const s = { box:0, right:0, wrong:0, seen:0, ...rec };
  s.seen++;
  let tally = null;
  if(g === 0){
    s.box = 0;                                         // forgot: back to day one
    if(!repeat){ s.wrong++; tally = false; }
  } else {
    const cap = repeat || (s.right === 0 && s.wrong > 0) ? RELEARN_BOX : STEPS.length - 1;
    const up = g === 1 ? 0 : g === 2 ? 1 : 2;
    s.box = Math.min(s.box + up, Math.max(s.box, cap));
    if(!repeat){ s.right++; tally = true; }
  }
  s.next = dayKey(STEPS[s.box]);
  s.lastSeen = today();
  return { rec: s, tally };
}
export function grade(id, g, opts){
  const { rec, tally } = applyGrade(store.getWord(id), g, opts);
  if(tally !== null) store.logAnswer(tally);
  return store.putWord(id, rec);
}

/** An answer in a lesson's recall step: the first attempt at the word from
 *  memory. It counts - seen, right or wrong, today's tally - so the word's
 *  record says what happened, but it moves neither the box nor the date: the
 *  first review is still tomorrow, and a miss here caps what that review can
 *  promote it to (see applyGrade). */
export function recallAnswer(id, ok){
  const s = store.getWord(id);
  if(!s) return store.logAnswer(ok);
  s.seen++;
  ok ? s.right++ : s.wrong++;
  store.logAnswer(ok);
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

/** Every open word with a reading plan, in the order the schedule wants
 *  them: the most overdue first, then whichever is closest to its turn.
 *  YYYY-MM-DD sorts as text, so no date needs parsing to compare. */
export function readingOrder(){
  const next = id => store.readingPlan(id).next;
  return [...introducedIds()]
    .filter(id => store.readingPlan(id))
    .sort((a,b) => next(a) < next(b) ? -1 : next(a) > next(b) ? 1 : a - b);
}

/** Words whose next text is due today or overdue, most overdue first. */
export const readingDue = () => {
  const t = today();
  return readingOrder().filter(id => store.readingPlan(id).next <= t);
};

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
  return store.setReadingPlan(id, { step, next: dayKey(READ_STEPS[step]) });
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
  if(w.box >= KNOWN_BOX && store.isReadProven(id)) level = 3;

  const plan = store.readingPlan(id);
  const slack = plan ? READ_STEPS[plan.step] : 1;
  const cooling = level > 0 && overdueBy(id) > slack;   // well past its turn
  return { level, cooling };
}

/* ---------- which cloze cards are not doing their job ---------- */
/** Cloze cards by miss rate, worst first, once each has been shown at least
 *  `minShown` times. A card many learners miss is too open or too hard, and
 *  is the one to rewrite in cloze_all.json. */
export function worstCards(minShown = 3){
  const stats = store.clozeStats();
  return Object.keys(stats)
    .filter(id => stats[id].shown >= minShown)
    .map(id => {
      const [wordId, n] = id.split(':').map(Number);
      return { id, card: (cloze[wordId] || [])[n] || null, ...stats[id],
               rate: stats[id].wrong / stats[id].shown };
    })
    .sort((a, b) => b.rate - a.rate || b.shown - a.shown);
}

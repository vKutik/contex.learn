/* util.js - small helpers more than one module needs.
 *
 * Nothing here knows about words, screens or storage. They live apart
 * because the router, the quiz and the scheduler all need them, and one copy
 * of a Fisher-Yates or a date format is better than two that can drift.
 */

/** A shuffled copy. The original is never touched. */
export function shuffle(a){
  const c = a.slice();
  for(let i = c.length-1; i > 0; i--){
    const j = Math.floor(Math.random()*(i+1)); [c[i],c[j]] = [c[j],c[i]];
  }
  return c;
}

/** One element at random, undefined for an empty array. */
export const one = a => a[Math.floor(Math.random()*a.length)];

/** The learner's calendar day, `n` days from `from`, as YYYY-MM-DD.
 *  Local time on purpose: a day ends at the learner's midnight, not at UTC's
 *  - toISOString() would start "tomorrow" at 02:00 in Kyiv. Every due date,
 *  reading plan and daily log is keyed by this one function. */
export function dayKey(n = 0, from = new Date()){
  const d = new Date(from);
  d.setDate(d.getDate() + n);
  const pad = x => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "1 word", "3 words" - the count and the noun, agreeing. */
export const plural = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

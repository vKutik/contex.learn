/* session.js - the shape of one review sitting.
 *
 * srs.js decides what is due and what a grade does to a word's schedule;
 * this module decides nothing about scheduling at all. It only answers "what
 * happens to *this session's* little queue" when a word gets graded - so a
 * miss can come back soon instead of last, a counter can only go up, and a
 * long run of misses eventually stops asking a learner the same word.
 *
 * No DOM, no storage, no randomness - like srs.js. The state it hands back
 * is plain JSON because it travels through the router as `go('review', {
 * session })`, and a page reload or a bad state should never throw here.
 */

/** At most this many words are pulled into one sitting - the number the home
 *  button promises, and the fixed denominator of the "Done x of y" pill. */
export const SESSION_SIZE = 7;
/** A Forgot answer resurfaces this many cards later, not at the tail. */
const GAP = 3;
/** A miss comes back only with at least this many other cards in between;
 *  with fewer left it waits for tomorrow instead. Shown again straight away,
 *  in the other prompt mode, it is answered from the reveal a second ago. */
const MIN_BETWEEN = 2;
/** Forgotten this many times in one sitting, the word waits for tomorrow. */
const MAX_MISSES = 2;
/** However many cards remain, a sitting stops after this many grades. */
const MAX_ANSWERS = 20;

/**
 * @param {number[]} ids the words for this sitting, most-overdue-first (or
 *   already shuffled within that priority - this module does not reorder
 *   the ids it is given beyond what re-inserting a miss requires).
 */
export function startSession(ids){
  const queue = ids.slice(0, SESSION_SIZE);
  return {
    total: queue.length,
    queue,
    misses: {},
    remembered: [],
    dropped: [],
    answers: 0,
    ended: queue.length === 0
  };
}

/** The word waiting to be shown, or null once the sitting is over. */
export const current = state => state.ended ? null : (state.queue[0] ?? null);

/** Distinct words finished never decreases; the denominator never changes. */
export const progress = state =>
  ({ done: state.remembered.length + state.dropped.length, total: state.total });

export const isFinished = state => state.ended;

/**
 * Grade `wordId` and return a new state. `srs.grade()` has already been
 * called by the caller - this only shapes what the *session* does next:
 * finish the word, or send a miss back GAP cards from now - or, with too few
 * cards left to put between, to tomorrow.
 */
export function answer(state, wordId, grade){
  if(state.ended) return state;

  const queue = state.queue.filter(id => id !== wordId);
  const misses = { ...state.misses };
  const remembered = state.remembered.slice();
  const dropped = state.dropped.slice();
  const answers = state.answers + 1;

  if(grade === 0){
    misses[wordId] = (misses[wordId] || 0) + 1;
    if(misses[wordId] >= MAX_MISSES || queue.length < MIN_BETWEEN){
      dropped.push(wordId);            // srs.grade(0) already booked tomorrow
    } else {
      const at = Math.min(GAP, queue.length);
      queue.splice(at, 0, wordId);     // soon, not last
    }
  } else {
    remembered.push(wordId);
  }

  const ended = answers >= MAX_ANSWERS || queue.length === 0;
  return { total: state.total, queue, misses, remembered, dropped, answers, ended };
}

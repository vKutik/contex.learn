/* data.js - the data contract for the whole app.
 *
 * Everything the UI ever reads about words, lessons and passages comes
 * through this module. Today it re-exports static JSON modules; when a
 * Python backend arrives, only the three loaders below change to
 *   const res = await fetch('/api/daily-lesson');
 * and no screen has to be touched.
 */
import { words }    from './data/words.js';
import { lessons }  from './data/lessons.js';
import { passages } from './data/passages.js';

export { words, lessons, passages };

export const DAILY_NEW_LIMIT = 5;   // words per batch
export const NEW_WINDOW_MS = 12 * 36e5;  // one batch per 12 hours
export const DAILY_BUDGET  = 80;         // max answers in a day

/** One word by id. */
export const wordById = id => words[id];

/** Resolve a lesson's wordIds into full word objects (DRY: stored once). */
export const lessonWords = lesson => lesson.wordIds.map(wordById);

/* Every word owns a shelf of ten passages, ordered by `slot`. A passage
   belongs to exactly one word, so "ten texts for this word" is literally
   true and the rounds have something to count through. One is drawn each
   time the word comes round on its reading interval - see srs.READ_STEPS. */
const SHELVES = passages.reduce((acc, p) => {
  (acc[p.w] = acc[p.w] || [])[p.slot] = p;
  return acc;
}, {});

/** The ten passages belonging to one word, in shelf order. */
export const shelfOf = wordId => SHELVES[wordId] || [];

/** Passages the learner can read: a passage opens with its own word alone.
 *  Other course words it happens to contain are marked, not required. */
export const openPassages = knownIds =>
  passages.filter(p => knownIds.has(p.w));

/* The async shape a REST backend would use. Screens already call these,
   so swapping the body for fetch() is the whole migration. */
export async function fetchWords()    { return words; }
export async function fetchLessons()  { return lessons; }
export async function fetchPassages() { return passages; }

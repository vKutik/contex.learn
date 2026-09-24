/* seed.mjs - starting progress for a browser test, in the exact shape
 * storage.js persists.
 *
 * A browser test that has to click its way to an interesting state spends
 * most of its time clicking, and fails for reasons that have nothing to do
 * with what it is checking. These builders write the state directly into the
 * throwaway context instead: five words already open, a word overdue for a
 * text, a lesson half finished. The shape is asserted against the real thing
 * by tests/unit/storage.test.mjs, so a drift shows up there and not as a
 * mystery here.
 */
import { dayKey } from '../../js/util.js';

/* The same local calendar day the app keys every date by - the browser and
   Node share the machine's time zone. */
export const dateIn = n => dayKey(n);
export const daysAgo = n => dateIn(-n);
export const hoursAgo = n => Date.now() - n * 36e5;

/**
 * @param {object} opts
 *   ids        word ids to open
 *   next       review date for them (default: tomorrow, i.e. nothing due)
 *   box        which box they sit in
 *   opened     how long ago they were opened, in hours (the 24h cap)
 *   reading    when their next text is due (default: today)
 *   proven     ids answered correctly from a passage
 *   read       passage ids already answered
 *   lessons    { [lessonId]: stage }
 *   clozeSeen  { [wordId]: [cardId] }  cloze cards already met, oldest first
 */
export function progress({
  ids = [], next = dateIn(1), box = 0, opened = 0,
  reading = dateIn(0), readingStep = 0, proven = [], read = [], lessons = {},
  clozeSeen = {}
} = {}){
  const state = { words:{}, ex:{}, rw:{}, read:{}, lesson:{ ...lessons },
                  rsched:{}, log:{}, clozeSeen:{ ...clozeSeen }, clozeStats:{}, grants:[] };
  for(const id of ids){
    state.words[id] = { box, right:0, wrong:0, seen:0,
      new: hoursAgo(opened), next, lastSeen: daysAgo(1) };
    if(reading) state.rsched[id] = { step: readingStep, next: reading };
  }
  for(const id of proven) state.rw[id] = 1;
  for(const id of read) state.read[id] = 1;
  return state;
}

/** The five words of lesson 1, opened and finished, with nothing due. */
export const afterFirstLesson = (over = {}) =>
  progress({ ids:[0,1,2,3,4], lessons:{ 1:'done' }, ...over });

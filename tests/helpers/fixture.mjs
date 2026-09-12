/* fixture.mjs - a clean, isolated world for every unit test.
 *
 * The whole point of these helpers is that a test run can never touch a
 * learner's progress. Under Node there is no `localStorage` and no
 * `window.storage`, so storage.js keeps its state in memory and its two
 * writers throw and are swallowed - `storageLabel()` says NOT SAVING, and
 * tests/unit/storage.test.mjs asserts exactly that. Nothing here creates a
 * browser profile, a temp file or a stub that could outlive the process.
 */
import * as store from '../../js/storage.js';

const DAY = 864e5;

/** Wipe every word, plan and log. Call at the top of each test. */
export const fresh = () => store.resetAll();

/** A word record as storage.js keeps them, with sane defaults. */
export const wordRecord = (over = {}) => ({
  box:0, right:0, wrong:0, seen:0, new: Date.now(), next: dateIn(1), lastSeen: today(), ...over
});

export const today  = () => new Date().toISOString().slice(0,10);
export const dateIn = n => { const d = new Date(); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); };
export const daysAgo = n => dateIn(-n);
export const hoursAgo = n => Date.now() - n * 36e5;

/** Put a word straight into storage, bypassing srs - for arranging a state
 *  that would otherwise take days of real time to reach. */
export const seedWord = (id, over = {}) => store.putWord(id, wordRecord(over));

/** A word that is due for review right now. */
export const seedDue = (id, over = {}) => seedWord(id, { next: daysAgo(1), ...over });

/**
 * Run `fn` with Date.now() shifted by `offsetMs`, then put it back.
 *
 * Only Date.now() moves - `new Date()` does not - which is deliberate: the
 * rolling 24h cap is the one piece of logic that reads the clock as a number,
 * and shifting only that keeps the calendar (YYYY-MM-DD due dates) honest.
 */
export async function withClock(offsetMs, fn){
  const real = Date.now;
  Date.now = () => real.call(Date) + offsetMs;
  try { return await fn(); } finally { Date.now = real; }
}

/** Run `fn` with Math.random returning `values` in order, cycling. Restores
 *  the real one even if the test throws, so one test can never leak a rigged
 *  random into the next file. */
export async function withRandom(values, fn){
  const real = Math.random;
  let i = 0;
  Math.random = () => values[i++ % values.length];
  try { return await fn(); } finally { Math.random = real; }
}

export const DAY_MS = DAY;

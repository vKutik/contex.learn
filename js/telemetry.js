/* telemetry.js - what the learner did, written down so it can be read later.
 *
 * The progress in storage.js says where a learner *is*; it cannot say how
 * they got there - which option they tapped instead, how long they looked
 * at a sentence, which text sent them to the tooltip three times, which
 * stage of a lesson they closed the tab on. Those are the questions the
 * schedule, the quiz mechanics and the corpus have to be tuned against, and
 * the answers cannot be recovered after the fact. So every one of them is
 * an event, appended here and kept by storage.js.
 *
 * Two promises:
 *   - it changes nothing. No event moves a due date, a box or the daily
 *     tally; turn this module into a no-op and the app learns identically.
 *   - it sends nothing. The log stays on the device until the learner
 *     exports it. A server, when there is one, reads the same events.
 *
 * One event: { t: ms since epoch, s: page session, b: build, e: name, ... }.
 * The names and their fields are listed in CLAUDE.md under "Usage log".
 */
import * as store from './storage.js';
import { BUILD } from './build.js';

/** One id per page load - a "sitting", as the log sees it. */
const SESSION = Math.random().toString(36).slice(2, 10);

export function track(e, data = {}){
  store.appendEvent({ t: Date.now(), s: SESSION, b: BUILD, e, ...data });
}

/* ---------- a clock that stops while the app is away ----------
   A reveal or a grade measured with Date.now() across a trip to another app
   came out as five minutes of "thinking". This clock stands still while the
   page is hidden, so every `ms` in the log is time the learner could see the
   card. Durations only: subtract two readings, never show one. */
let awaySince = null, awayTotal = 0;
if(typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'hidden'){ if(awaySince === null) awaySince = Date.now(); }
  else if(awaySince !== null){ awayTotal += Date.now() - awaySince; awaySince = null; }
});
export const activeNow = () =>
  Date.now() - awayTotal - (awaySince === null ? 0 : Date.now() - awaySince);

/* ---------- things nobody calls track() for ---------- */

/** A thrown error or rejected promise nobody caught - on the live site that
 *  is otherwise invisible. Capped, so a render loop cannot fill the log. */
const MAX_ERRORS = 20;

/** Listen for errors and for the page going away. `where` names the screen
 *  on show, so the log can say which one people leave from. */
export function startTelemetry(where){
  let errors = 0;
  const fail = (msg, at, stack) => {
    if(++errors > MAX_ERRORS) return;
    track('error', { msg: String(msg).slice(0, 200), at, stack: String(stack || '').slice(0, 400) });
  };
  window.addEventListener('error', ev =>
    fail(ev.message, `${(ev.filename || '').split('/').pop()}:${ev.lineno}:${ev.colno}`, ev.error?.stack));
  window.addEventListener('unhandledrejection', ev =>
    fail(ev.reason?.message || ev.reason, 'promise', ev.reason?.stack));

  // hidden is the last moment a phone reliably lets a page run. iOS can say
  // "hidden" twice for one trip away, and pagehide may come on top of it, so
  // a leave is logged once and not again until the page has been visible
  let away = false, since = Date.now();
  const leave = () => {
    if(!away){
      away = true;
      const sum = sittingSummary(store.eventLog(), since);
      if(sum) track('session', sum);
      track('leave', { screen: where() });
    }
    store.flushEvents();
  };
  const back = () => { if(away){ away = false; since = Date.now(); } };
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'hidden') leave(); else back();
  });
  window.addEventListener('pagehide', leave);
  window.addEventListener('pageshow', back);
}

/** What one stretch of use came to, from this page's events since `from`:
 *  cards answered or graded, how many different words, how many words were
 *  right the first time they came up, and how long it took. Null when
 *  nothing was answered - a glance at the home screen is not a sitting. */
function sittingSummary(events, from){
  const work = events.filter(x => x.s === SESSION && x.t >= from &&
    (x.e === 'answer' || x.e === 'grade'));
  if(!work.length) return null;
  const first = new Map();
  for(const x of work) if(x.w != null && !first.has(x.w))
    first.set(x.w, x.e === 'grade' ? x.g > 0 : !!x.ok);
  const firstRight = [...first.values()].filter(Boolean).length;
  return { cards: work.length, words: first.size, firstRight,
           first: first.size ? Math.round(100 * firstRight / first.size) / 100 : null,
           ms: Date.now() - from };
}

/* ---------- reading the log back ---------- */

const median = xs => {
  if(!xs.length) return null;
  const s = xs.slice().sort((a,b) => a-b), m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m-1] + s[m]) / 2);
};

const count = (items, key) => {
  const n = {};
  for(const x of items){ const k = key(x); n[k] = (n[k] || 0) + 1; }
  return n;
};

/** The lesson stages, in order, as `screen` events name them. */
const STAGE_NAMES = ['cards', 'recall', 'reading', 'quiz'];

/**
 * What the log says, in the few numbers worth looking at first. Pure: it
 * takes the events and nothing else, so it can run on an exported file too.
 * Ids are returned as ids - turning them into words is the caller's job.
 */
export function summarize(events){
  const answers = events.filter(x => x.e === 'answer');

  // how many distinct lessons got as far as each stage, then all the way
  const reached = STAGE_NAMES.map(() => new Set());
  for(const x of events) if(x.e === 'screen' && x.name === 'lesson' && reached[x.st]) reached[x.st].add(x.l);
  const done = new Set(events.filter(x => x.e === 'lesson_done').map(x => x.l));
  const funnel = [...STAGE_NAMES.map((stage, k) => ({ stage, n: reached[k].size })),
                  { stage:'done', n: done.size }];

  const mech = Object.keys(count(answers, x => x.k)).map(k => {
    const of = answers.filter(x => x.k === k);
    return { k, n: of.length, ok: of.filter(x => x.ok).length, ms: median(of.map(x => x.ms).filter(Number.isFinite)) };
  }).sort((a,b) => b.n - a.n);

  // hardest words: most misses per answer, among words answered often enough to say
  const byWord = {};
  for(const x of [...answers.filter(a => a.w != null), ...events.filter(g => g.e === 'grade')]){
    const r = byWord[x.w] || (byWord[x.w] = { w: x.w, n:0, miss:0 });
    r.n++;
    if(x.e === 'grade' ? x.g === 0 : !x.ok) r.miss++;
  }
  const words = Object.values(byWord).filter(r => r.n >= 3 && r.miss)
    .sort((a,b) => b.miss/b.n - a.miss/a.n || b.n - a.n).slice(0, 5);

  // hardest texts: missed checks first, then how often the tooltip was needed
  const byPassage = {};
  const row = p => byPassage[p] || (byPassage[p] = { p, n:0, miss:0, peek:0 });
  for(const x of answers) if(x.p != null){ row(x.p).n++; if(!x.ok) row(x.p).miss++; }
  for(const x of events) if(x.e === 'peek' && x.p != null) row(x.p).peek++;
  const passages = Object.values(byPassage).filter(r => r.miss || r.peek)
    .sort((a,b) => b.miss - a.miss || b.peek - a.peek).slice(0, 5);

  const exits = Object.entries(count(events.filter(x => x.e === 'leave'), x => x.screen))
    .map(([screen, n]) => ({ screen, n })).sort((a,b) => b.n - a.n);

  return {
    events: events.length,
    sessions: new Set(events.map(x => x.s)).size,
    since: events.length ? events[0].t : null,
    funnel, mech, words, passages, exits,
    errors: events.filter(x => x.e === 'error').slice(-5).reverse()
  };
}

/* ---------- handing it over ---------- */

/** Download the whole log, with the progress it produced, as one JSON file.
 *  This is the only way anything in the log leaves the device. */
export function exportLog(){
  const day = new Date().toISOString().slice(0, 10);
  const file = {
    app: 'ContextLearn', build: BUILD, uid: store.installId(),
    exported: new Date().toISOString(), agent: navigator.userAgent,
    progress: store.snapshot(), events: store.eventLog()
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type:'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = `contextlearn-log-${day}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  track('export', { n: file.events.length });
}

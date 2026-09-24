/* storage.js - the only module allowed to touch persisted progress.
 *
 * Nothing else reads or writes localStorage. Screens ask for a snapshot and
 * call the mutators below; that keeps saving in one place and makes the
 * swap to `fetch('/api/progress')` a change to read()/write() alone.
 *
 * Shape (unchanged from the previous version, so old progress still loads):
 *   words : { [wordId]: { box, right, wrong, seen, new, next, lastSeen } }
 *   ex    : { [wordId]: index of the example last shown }
 *   rw    : { [wordId]: 1 }   answered correctly inside a passage
 *   read  : { [passageId]: 1 }
 *   lesson: { [lessonId]: 'reading' | 'quiz' | 'done' }
 *   rsched: { [wordId]: { step, next } }  when this word is next due a text
 *   grants: [ timestamp ]  each +5 words tap, one extra batch apiece
 *
 * The usage log sits beside it under its own key (see the bottom of this
 * file): it grows with every tap, and re-serialising it on every progress
 * save would make the one write that matters pay for the one that doesn't.
 */
const KEY = 'vocab-progress';

const empty = () => ({ words:{}, ex:{}, rw:{}, read:{}, lesson:{}, rsched:{},
                       log:{}, grants:[], streak:0, last:null });

let state = empty();

/* ---------- the storage back end (cloud + browser, best of the two) ---------- */
const Backend = {
  cloud:false, local:false,

  async read(){
    let a=null, b=null;
    try { const r = await window.storage.get(KEY); this.cloud=true; if(r&&r.value) a=r.value; } catch(e){}
    try {
      b = localStorage.getItem(KEY);
      localStorage.setItem(KEY+'-probe','1'); localStorage.removeItem(KEY+'-probe');
      this.local = true;
    } catch(e){}
    const size = v => { try { return Object.keys(JSON.parse(v).words||{}).length; } catch(e){ return -1; } };
    if(a && b) return size(a) >= size(b) ? a : b;   // whichever copy holds more progress wins
    return a || b;
  },

  async write(v){
    let ok=false;
    try { await window.storage.set(KEY,v); this.cloud=true; ok=true; } catch(e){ this.cloud=false; }
    try { localStorage.setItem(KEY,v);     this.local=true; ok=true; } catch(e){ this.local=false; }
    return ok;
  },

  label(){
    return this.cloud && this.local ? 'app + browser'
         : this.cloud ? 'app' : this.local ? 'browser' : 'NOT SAVING';
  }
};

/* ---------- lifecycle ---------- */
export async function load(){
  const raw = await Backend.read();
  if(raw){ try { state = { ...empty(), ...JSON.parse(raw) }; } catch(e){} }
  for(const k of ['words','ex','rw','read','lesson','rsched','log']) if(!state[k]) state[k] = {};
  // texts flagged by the removed "?" button: back on the shelf, and the key
  // written out of the save rather than left behind as inert cruft
  if(state.murky){ delete state.murky; await save(); }
  if(!Array.isArray(state.grants)) state.grants = [];   // progress saved before grants existed
  // progress saved before the daily cap existed has no `new` stamp
  for(const id of Object.keys(state.words)){
    const s = state.words[id];
    if(!s.new) s.new = (s.seen === 0 && s.lastSeen) ? Date.parse(s.lastSeen+'T12:00') : 0;
  }
  loadEvents();
  return state;
}

const save               = () => Backend.write(JSON.stringify(state));
export const snapshot    = () => state;            // read-only by convention
export const storageLabel= () => Backend.label();

/* ---------- mutators: the only way progress ever changes ---------- */
export function putWord(id, rec){ state.words[id] = rec; return save(); }
export function getWord(id){ return state.words[id]; }

export function setExample(id, n){ state.ex[id] = n; return save(); }
export function getExample(id){ return state.ex[id] || 0; }

/** The learner proved the word from a passage, not from its card. */
export function markReadCorrect(id){ state.rw[id] = 1; return save(); }
export const isReadProven = id => !!state.rw[id];

export function markPassageRead(pid){ state.read[pid] = 1; return save(); }
export const isPassageRead = pid => !!state.read[pid];

export function setLessonStage(lessonId, stage){ state.lesson[lessonId] = stage; return save(); }
export const lessonStage = lessonId => state.lesson[lessonId] || null;

/* ---------- extra new words the learner asked for ----------
   The five-a-day cap is the pace the review intervals are built around, so
   it is never raised permanently. A grant is one timestamp worth one extra
   batch, and it ages out of the rolling 24 hours exactly like an opened
   word does - so tomorrow starts at five again, by itself. */
export function grantNewWords(){ state.grants.push(Date.now()); return save(); }
export const grantsSince = t => state.grants.filter(x => x > t).length;

/* ---------- when each word is next due a reading ---------- */
export const readingPlan = wordId => state.rsched[wordId] || null;
export function setReadingPlan(wordId, plan){ state.rsched[wordId] = plan; return save(); }

/** Daily right/wrong tally, used by the end-of-session summary. */
export function logAnswer(right){
  const t = new Date().toISOString().slice(0,10);
  const day = state.log[t] || (state.log[t] = { right:0, wrong:0 });
  right ? day.right++ : day.wrong++;
  return save();
}
export const todayLog = () => state.log[new Date().toISOString().slice(0,10)] || { right:0, wrong:0 };

/** Wipe every word, lesson and log - a hard reset back to a fresh install.
 *  Developer-only tool (see js/settings.js); not reachable from normal UI.
 *  The usage log is left alone: a reset is something that happened, not a
 *  reason to forget what happened before it. */
export async function resetAll(){
  state = empty();
  await save();
  return state;
}

/* ---------- the usage log ----------
   What the learner did, in order: every answer, reveal, grade, tooltip and
   screen, so that where people struggle can be read afterwards instead of
   guessed. It never feeds back into learning - nothing here moves a due date
   or a tally - and it never leaves the device by itself; the learner exports
   it. The shape of one event is decided in js/telemetry.js, not here.

     { uid, events: [ { t, s, b, e, ...fields } ] }

   Only the browser copy is kept, capped, and written a moment after the last
   event rather than on every one: a quiz answer is several events, and the
   page going into the background writes whatever is still waiting. */
const EVENTS_KEY = 'vocab-events';
const MAX_EVENTS = 3000;
const FLUSH_MS = 2000;

let journal = { uid:null, events:[] };
let flushTimer = null;

const newId = () => (globalThis.crypto && crypto.randomUUID)
  ? crypto.randomUUID()
  : Date.now().toString(36) + Math.random().toString(36).slice(2);

function loadEvents(){
  let kept = null;
  try { kept = JSON.parse(localStorage.getItem(EVENTS_KEY) || 'null'); } catch(e){}
  const events = Array.isArray(kept?.events) ? kept.events : [];
  // anything logged while the page was still loading goes after what was kept
  journal = { uid: kept?.uid || journal.uid || newId(), events: [...events, ...journal.events] };
  trim();
}

const trim = () => { if(journal.events.length > MAX_EVENTS) journal.events.splice(0, journal.events.length - MAX_EVENTS); };

/** Write the log now. Called on a timer, and when the page is being hidden. */
export function flushEvents(){
  clearTimeout(flushTimer); flushTimer = null;
  try { localStorage.setItem(EVENTS_KEY, JSON.stringify(journal)); } catch(e){}
}

export function appendEvent(ev){
  journal.events.push(ev);
  trim();
  // no browser storage (Node, a locked-down profile): memory only, no timer
  if(Backend.local && !flushTimer) flushTimer = setTimeout(flushEvents, FLUSH_MS);
}

export const eventLog  = () => journal.events;          // read-only by convention
export const installId = () => journal.uid || (journal.uid = newId());

export function clearEvents(){ journal.events = []; flushEvents(); }

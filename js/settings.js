/* settings.js - app-level preferences, kept apart from storage.js: this is
 * how the app is shown, not learning progress. Currently just the developer
 * flag and the typed-answer option.
 */
const KEY = 'vocab-settings';

const defaults = () => ({ devMode: false, typeCloze: false });

let state = defaults();
try { state = { ...defaults(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch(e){}

function persist(){ try { localStorage.setItem(KEY, JSON.stringify(state)); } catch(e){} }

export const isDevMode = () => state.devMode;
function setDevMode(v){ state.devMode = !!v; persist(); }

/* Typing the missing word instead of tapping it. Off by default: one tap is
 * the answer everywhere else in the learning flow, so this is something a
 * learner turns on, not something they meet. */
export const typesCloze = () => state.typeCloze;
export function setTypesCloze(v){ state.typeCloze = !!v; persist(); }

/* Developer mode is not a button anyone taps by accident: it unlocks the
 * same way Android's build-number trick does - five taps on one label,
 * inside a short window, resets if you pause too long. */
const UNLOCK_TAPS = 5;
const TAP_WINDOW_MS = 1500;
let tapCount = 0, tapTimer = null;

/** Call on every tap of the unlock label. Returns true the moment dev mode
 *  turns on (so the caller can react once, not on every tap after). */
export function registerUnlockTap(){
  tapCount++;
  clearTimeout(tapTimer);
  tapTimer = setTimeout(() => { tapCount = 0; }, TAP_WINDOW_MS);
  if(tapCount >= UNLOCK_TAPS){
    tapCount = 0;
    if(!state.devMode){ setDevMode(true); return true; }
  }
  return false;
}

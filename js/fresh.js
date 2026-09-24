/* fresh.js - notices when the page is running code that has been replaced.
 *
 * A tab restored from the background can be hours old: iOS brings it back
 * without asking the server anything, so a fix that shipped in the meantime
 * is simply not there, and the only symptom is that nothing you changed
 * appears to have changed. That is not something a learner should have to
 * diagnose by reloading and hoping.
 *
 * version.txt is fetched without touching the cache and compared with the
 * BUILD baked into the modules that are actually running. A page holding
 * stale modules carries a stale BUILD, so the two disagree and it reloads
 * itself - once per session, so a cache that refuses to let go can never
 * put the page in a loop.
 */
import { BUILD } from './build.js';
import { track } from './telemetry.js';
import { flushEvents } from './storage.js';

const ONCE = 'reloaded-for-build';

async function deployed(){
  const res = await fetch('version.txt', { cache:'no-store' });
  return res.ok ? (await res.text()).trim() : null;
}

async function check(){
  try {
    const live = await deployed();
    if(!live || live === BUILD) return;
    if(sessionStorage.getItem(ONCE) === live) return;   // already tried this one
    sessionStorage.setItem(ONCE, live);
    track('stale_reload', { to: live });
    flushEvents();                                      // the reload will not wait for the timer
    location.reload();
  } catch(e){}                                          // offline: keep running
}

export function watchForNewBuild(){
  check();
  // the case that matters: a tab coming back to the front after a long while
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible') check();
  });
}

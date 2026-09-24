/* motion.js - the one place that knows how a screen arrives.
 *
 * Screens used to be swapped in with a bare innerHTML assignment, which cuts
 * rather than moves. Where the browser has view transitions the outgoing
 * screen now cross-fades into the incoming one; where it does not, the new
 * screen eases up into place on its own. Either way nothing here changes
 * what is rendered - only how it lands.
 */

/** Someone who has asked their system for less movement gets none. */
const calm = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Restart the enter animation on an element that was just repainted. */
export function easeIn(el){
  if(!el || calm()) return;
  el.classList.remove('enter');
  void el.offsetWidth;          // reflow, or the animation will not replay
  el.classList.add('enter');
}

/**
 * Repaint `el` through a transition.
 * @param {HTMLElement} el      the element `render` rewrites
 * @param {Function} render     does the actual rendering
 * @param {Function} [after]    runs inside the transition, e.g. scroll reset
 */
export function paint(el, render, after){
  const done = () => { render(); if(after) after(); };

  // a page restored in the background (iOS does this on every return) has
  // nothing to animate: the browser would skip the transition and reject
  // its promises, so paint straight away instead
  if(calm() || document.visibilityState !== 'visible') return done();

  if(document.startViewTransition){
    const t = document.startViewTransition(done);   // true cross-fade, old and new
    // a transition skipped anyway (the tab hid mid-way, another started) is
    // not an error: the new screen is painted either way. updateCallbackDone
    // is left alone - it rejects only when render() itself threw, and that
    // should reach the error log
    const quiet = () => {};
    t.ready?.catch(quiet); t.finished?.catch(quiet);
    return;
  }
  done();
  easeIn(el);                             // no snapshots: ease the new one in
}

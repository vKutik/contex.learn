/* progress.js - the round progress gauge and the small legend under it.
 * Pure rendering: hand it the four counts, it returns markup. */
import { STEP_NAME } from '../srs.js';
import { plural } from '../util.js';

const ARC = 282.74;   // length of the 90px semicircle drawn below

/* A word's journey has three landings, and the number counts all of them.
 *
 * It used to be `known / total`, and `known` means box 4 - which, answering
 * "Good" every time, is the 27th day after a word is opened. So the headline
 * read 0% for the first month no matter how much work went in, while the arc
 * beneath it was already coloured for every word touched: the picture and the
 * number were measuring different things on the same screen.
 *
 * Now both measure this. Opening a word is a third of the way, proving it
 * inside a real passage is two thirds, and box 4 is the whole of it.
 */
const WEIGHT = { started: 1/3, read: 2/3, known: 1 };

/**
 * @param {{known:number, read:number, started:number, total:number}} c
 * @returns {string} markup for the gauge plus its legend
 */
export function progressRing(c){
  const score = c.known * WEIGHT.known + c.read * WEIGHT.read + c.started * WEIGHT.started;
  // real work must never round away to nothing - that was the whole complaint
  const pct = score > 0 ? Math.max(1, Math.round(100 * score / c.total)) : 0;

  // the arc is the same sum, drawn: each step contributes its own weight, so
  // the coloured sweep and the number can never disagree again
  const share = (n, w) => ARC * n * w / c.total;
  const green = share(c.known, WEIGHT.known);
  const amber = green + share(c.read, WEIGHT.read);
  const red   = amber + share(c.started, WEIGHT.started);
  const seg = (colour, len) =>
    `<path class="seg" d="M20 112 A90 90 0 0 1 200 112" stroke="${colour}" stroke-dasharray="${len} ${ARC}"/>`;

  return `
  <div class="gauge">
    <svg viewBox="0 0 220 124" width="100%" role="img"
         aria-label="${pct}% of the way through ${c.total} words">
      ${seg('var(--track)', ARC)}
      ${seg('var(--red)', red)}
      ${seg('var(--amber)', amber)}
      ${seg('var(--green)', green)}
      <text class="gnum" x="110" y="96" text-anchor="middle">${pct}<tspan class="gpct">%</tspan></text>
    </svg>
  </div>
  <div class="key">
    ${['known','read','started'].map(step =>
      `<span><i class="dot ${step}"></i>${STEP_NAME[step]} <b>${c[step]}</b></span>`).join('')}
  </div>
  ${todayLine(c.today, c.budget)}`;
}

/* The percentage is a slow number by design - a whole lesson moves it two
   points, because a hundred words really is a hundred words. Today's tally
   is the fast one, and it is the one that answers "did I get anywhere just
   now". It is also the day's budget, so the two share one line rather than
   saying the same number twice; "right" joins it once there is any work. */
function todayLine(t, budget){
  const n = t ? t.right + t.wrong : 0;
  const done = budget ? `${n} of ${plural(budget, 'answer')}` : plural(n, 'answer');
  return `<div class="today">${done} today${n ? ` · <b>${t.right}</b> right` : ''}</div>`;
}

/**
 * The familiarity index: three dots telling the story of one word rather
 * than a percentage. Filled dots are steps taken; a cooling one has faded
 * because the word is long past due. At three the dots close into a line.
 *
 * @param {{level:number, cooling:boolean}} fam from srs.familiarity()
 */
export function familiarityDots(fam){
  const titles = ['not met in a text yet', 'read in a text',
                  'answered from the text', 'mastered'];
  const dots = [0,1,2].map(i => {
    if(i >= fam.level) return '<i></i>';
    const last = i === fam.level - 1;
    return `<i class="on${fam.cooling && last ? ' cool' : ''}"></i>`;
  }).join('');
  return `<span class="fam${fam.level === 3 ? ' full' : ''}"
    role="img" aria-label="${titles[fam.level]}" title="${titles[fam.level]}">${dots}</span>`;
}

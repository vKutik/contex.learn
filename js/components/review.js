/* review.js - the spaced-repetition screen. Recall first, reveal second,
 * then say how hard it was; srs.js turns that into the next due date. */
import { wordFace, wireWordFace, exampleOf, blankOf, gapOf, filledOf } from './word.js';
import { pickCloze, recordCloze } from './quiz.js';
import * as srs from '../srs.js';
import * as store from '../storage.js';

const GRADES = [
  { g:0, label:'Forgot', note:'again soon',       cls:'g0' },
  { g:1, label:'Hard',   note:'same interval',    cls:''   },
  { g:2, label:'Good',   note:'next interval',    cls:''   },
  { g:3, label:'Easy',   note:'skip an interval', cls:'g3' }
];

/**
 * @param {HTMLElement} container
 * @param {object} word
 * @param {{done:number,total:number,revealed:boolean,fam?:object}} pos
 * @param {{onReveal:Function, onGrade:(g:number)=>void, onRerender:Function}} handlers
 */
export function renderReview(container, word, pos, handlers){
  const seen = store.getWord(word.id)?.seen || 0;
  // alternate between "which word is missing" and "what does it mean"
  const askCloze = seen % 2 === 0;
  // the same card on both sides of the reveal: nothing is recorded until the
  // grade, so asking twice gives the same answer
  const card = askCloze ? pickCloze(word.id) : null;

  if(!pos.revealed){
    container.innerHTML = `
      <div class="top">
        <span class="pill">Done ${pos.done} of ${pos.total}</span>
        <span class="pill">${srs.STEP_NAME[srs.stepOf(word.id)]}</span>
      </div>
      <div class="card">
        ${askCloze
          ? `<p class="muted">Which word is missing?</p><div class="cloze">${
              card ? gapOf(card.s) : blankOf(exampleOf(word))}</div>`
          : `<p class="muted">What does this word mean?</p>
             <div class="word">${word.word}</div><div class="pos">/${word.ipa}/ · ${word.pos}</div>`}
        <p class="muted">Recall it yourself, out loud, and only then reveal it.</p>
      </div>
      <button class="go" id="show">Show answer</button>`;
    container.querySelector('#show').onclick = handlers.onReveal;
    return;
  }

  container.innerHTML = `
    <div class="card">
      ${card ? `<div class="cloze">${filledOf(card.s, card.a)}</div>` : ''}
      ${wordFace(word, pos.fam)}
      <button class="say alt" data-alt>Show another example</button>
    </div>
    <p class="muted">How easily did it come back?</p>
    <div class="grade">
      ${GRADES.map(x => `<button class="${x.cls}" data-g="${x.g}">${x.label}<small>${x.note}</small></button>`).join('')}
    </div>`;

  wireWordFace(container, word, handlers.onRerender);
  container.querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
    // a self-graded card: Forgot is the miss, anything else the hit
    if(card) recordCloze(word.id, card.id, +b.dataset.g === 0 ? 'wrong' : 'correct');
    handlers.onGrade(+b.dataset.g);
  });
}

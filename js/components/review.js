/* review.js - the spaced-repetition screen. Recall first, reveal second,
 * then say how hard it was; srs.js turns that into the next due date.
 * Like the flashcard, it is handed everything it shows about the word's
 * progress rather than asking the scheduler itself. */
import { wordFace, wireWordFace, exampleOf, blankOf, gapOf, filledOf } from './word.js';
import { pickCloze, recordCloze } from './quiz.js';

const GRADES = [
  { g:0, label:'Forgot', note:'again soon',       cls:'g0' },
  { g:1, label:'Hard',   note:'same interval',    cls:''   },
  { g:2, label:'Good',   note:'next interval',    cls:''   },
  { g:3, label:'Easy',   note:'skip an interval', cls:'g3' }
];

/**
 * @param {HTMLElement} container
 * @param {object} word
 * @param {{done:number, total:number, revealed:boolean, step:string,
 *          seen:number, fam?:object}} pos  `step` is the label of the word's
 *          step, `seen` how many times it has been reviewed
 * @param {{onReveal:(mode:string, cardId?:string)=>void, onGrade:(g:number)=>void, onRerender:Function}} handlers
 *   `mode` is which prompt was asked: 'cloze' or 'meaning'; the second
 *   argument is the cloze card's id when one was shown.
 */
export function renderReview(container, word, pos, handlers){
  // alternate between "which word is missing" and "what does it mean" - a
  // tricky word too: context is what it needs most, and pickCloze gives it
  // a fresh sentence rather than the one it keeps failing
  const askCloze = pos.seen % 2 === 0;
  // the same card on both sides of the reveal: nothing is recorded until the
  // grade, so asking twice gives the same answer
  const card = askCloze ? pickCloze(word.id) : null;

  if(!pos.revealed){
    container.innerHTML = `
      <div class="top">
        <span class="pill">Done ${pos.done} of ${pos.total}</span>
        <span class="pill">${pos.step}</span>
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
    container.querySelector('#show').onclick = () => handlers.onReveal(askCloze ? 'cloze' : 'meaning', card?.id);
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

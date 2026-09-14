/* flashcard.js - stage 1. The word, how it sounds, what it means, and one
 * sentence around it. No test here: a test one second after reading the
 * answer proves nothing, the real check is the review tomorrow.
 *
 * The card's contents are word.js's `wordFace` - the review reveal shows the
 * same block, so only the buttons around it belong to this screen.
 */
import { wordFace, wireWordFace } from './word.js';

/**
 * @param {HTMLElement} container
 * @param {object} word
 * @param {{label:string, next:string, fam?:object, isNew?:boolean}} pos
 * @param {{onNext:Function, onRerender:Function}} handlers
 */
export function renderFlashcard(container, word, pos, handlers){
  container.innerHTML = `
    <div class="top"><span class="pill">${pos.label}</span></div>
    <div class="card">${wordFace(word, pos.fam, pos.isNew)}</div>
    <button class="go" id="next">${pos.next}</button>
    <button class="go ghost" data-alt>Show another example</button>`;

  wireWordFace(container, word, handlers.onRerender);
  container.querySelector('#next').onclick = handlers.onNext;
}

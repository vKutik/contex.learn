/* reader.js - the reading screen.
 *
 * It is handed a passage ({ text, source }) and does two things:
 * paints it, and hangs a tooltip on every <mark data-word="..."> the data
 * already carries. It never looks a word up itself - the caller passes a
 * dictionary, so the same module serves lessons and extra reading alike.
 */
import { showTooltip, hideTooltip } from './tooltip.js';

/**
 * @param {HTMLElement} container element to render into
 * @param {{text:string, source?:string}} passage
 * @param {Map<string,object>} dict headword -> word object
 * @param {(wordId:number)=>number} [famOf] 0-3, how well the word is known
 */
export function initReader(container, passage, dict, famOf){
  container.innerHTML =
    `<div class="story">${passage.text}</div>` +
    (passage.source ? `<div class="source">${passage.source}</div>` : '');

  container.querySelectorAll('mark').forEach(el => {
    el.setAttribute('role','button');
    el.setAttribute('tabindex','0');

    /* Signalling that steps back as the word settles. A highlight is there to
       make a new word findable; a word you already know does not need finding,
       and the cue that helps a beginner gets in the way of someone past that
       stage. By the last level the word sits in the text like any other and
       the eye has to do the noticing - which is the work that reading for
       meaning is supposed to involve. It stays tappable throughout. */
    if(famOf){
      const w = dict.get(el.dataset.word);
      if(w) el.classList.add('lvl' + famOf(w.id));
    }

    const open = e => {
      e.stopPropagation();
      const word = dict.get(el.dataset.word);
      if(!word) return;
      // a passage's own sense wins over the card's when this text uses the
      // word differently - see the polysemy note in js/data/passages.js
      const sense = (passage.w === word.id && passage.sense) ? passage.sense : word.definition;
      // translation is on the word object but left out of the tooltip for now
      showTooltip(el, {
        title: `${word.word} /${word.ipa}/`,
        say: { id: word.id, word: word.word },
        hint: sense
      });
    };

    el.addEventListener('click', open);
    el.addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' ') open(e); });
  });

  return { destroy: hideTooltip };
}

/** headword -> word object, for the dictionary argument above. */
export const dictOf = words => new Map(words.map(w => [w.word, w]));

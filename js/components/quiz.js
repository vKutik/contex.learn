/* quiz.js - the checking stage.
 *
 * Three mechanics instead of one list of radio buttons, all built from the
 * word list at run time:
 *
 *   gap    a sentence with the word cut out; choose it back from pills
 *   match  the word, and two sentences; choose the one that means it
 *   focus  one sentence, one claimed meaning, yes or no
 *
 * The lesson's own comprehension questions come in as kind 'choice' and use
 * the same runner, so every quiz in the app answers in one tap and gives the
 * same feedback: a miss never flashes red, it lifts the right answer in
 * amber and says what the word actually means.
 */
import { easeIn } from './motion.js';
import { surfaceOf, blankOf, markedOf, gapOf, filledOf, wordsOf } from './word.js';
import { shuffle, one } from '../util.js';
import { clozeFor } from '../data.js';
import { typesCloze } from '../settings.js';
import * as store from '../storage.js';
import { isLeech, trickyCard } from '../srs.js';
import { activeNow } from '../telemetry.js';

/* ---------- small helpers ---------- */
const matchCase = (text, model) => !text ? text
  : /^[A-Z]/.test(model) ? text[0].toUpperCase() + text.slice(1)
                         : text[0].toLowerCase() + text.slice(1);

/* Which ending a form carries, so a row of options can never be solved by
   spotting the only -ed among four dictionary forms. */
function shapeOf(surface, base){
  const s = String(surface).toLowerCase(), b = String(base).toLowerCase();
  if(s === b) return 'base';
  if(s.endsWith('ing')) return 'ing';
  if(s.endsWith('ed') || s.endsWith('d')) return 'past';
  if(s.endsWith('s')) return 's';
  return 'base';
}

/* Last-resort regular inflection, only for words whose own examples never
   show the ending we need. Real forms from the examples always win, so the
   irregular ones (shrank, spilt) come from there rather than from here.
   The few this cannot build by rule are spelled out: English doubles the
   last letter only when the final syllable is stressed, which no short
   regex knows, and irregular pasts are irregular. */
const ODD = {
  scatter: { past:'scattered', ing:'scattering' },
  shrink:  { past:'shrank',    ing:'shrinking'  },
  swallow: { past:'swallowed', ing:'swallowing' },
  borrow:  { past:'borrowed',  ing:'borrowing'  },
  whistle: { past:'whistled',  ing:'whistling'  }
};
const doubles = w => /[^aeiou][aeiou][bdglmnprt]$/.test(w);
function inflect(base, shape){
  const odd = ODD[base] && ODD[base][shape];
  if(odd) return odd;
  if(shape === 'past'){
    if(base.endsWith('e')) return base + 'd';
    if(/[^aeiou]y$/.test(base)) return base.slice(0,-1) + 'ied';
    return doubles(base) ? base + base.slice(-1) + 'ed' : base + 'ed';
  }
  if(shape === 'ing'){
    if(base.endsWith('e') && !base.endsWith('ee')) return base.slice(0,-1) + 'ing';
    return doubles(base) ? base + base.slice(-1) + 'ing' : base + 'ing';
  }
  if(shape === 's'){
    if(/(s|sh|ch|x|o)$/.test(base)) return base + 'es';
    if(/[^aeiou]y$/.test(base)) return base.slice(0,-1) + 'ies';
    return base + 's';
  }
  return base;
}

/** A real form of `word` carrying the same ending as the answer, taken from
 *  its own examples - null when it has none of that shape. */
function realForm(word, shape){
  const forms = word.examples.map(surfaceOf).filter(Boolean);
  return forms.find(f => shapeOf(f, word.word) === shape) || null;
}

/** A form of `word` carrying the same ending as the answer, so the shape of
 *  the options never points at the right one. */
const surfaceLike = (word, shape) => realForm(word, shape) || inflect(word.word, shape);

const sameClass = (word, allWords) =>
  allWords.filter(w => w.pos === word.pos && w.id !== word.id);

/* The focus mechanics answer yes or no, in this order - it is never shuffled. */
const YES_NO = ['Yes, it fits', 'No, it does not'];

/* ---------- 1. Context gap fill ----------
   The gap comes from a hand-written cloze card (js/data/cloze.js) whenever the
   word has one: five per word, each built so the sentence around the gap
   points at the word - by what it causes, what causes it, what it is set
   against, what it means, or what it usually goes with. A word with no cards
   falls back to cutting the gap out of one of its own examples. */

/** The order a word's cards are first met in: the sentence that explains the
 *  word first, the collocation - which asks the most of recall - last. */
const ANCHOR_ORDER = ['df', 'cq', 'ca', 'ct', 'cl'];
const byAnchor = (a, b) => ANCHOR_ORDER.indexOf(a.t) - ANCHOR_ORDER.indexOf(b.t);

/**
 * Which of a word's cloze cards to ask. The only place a card is chosen.
 *
 *  - never the sentence just read (`avoidSentence`, an example with braces or
 *    a cloze sentence): the card counts as that sentence when one contains the
 *    other, since several cards grow out of the card's own examples
 *  - a card not met before, in ANCHOR_ORDER
 *  - once all have been met, the one met longest ago
 *  - for a tricky word (srs.isLeech), srs.trickyCard decides instead: never
 *    met, else worst record, never the card met last
 *
 * @returns {object|null} the card, or null when the word has none to give
 */
export function pickCloze(wordId, { avoidSentence } = {}){
  const avoid = avoidSentence ? wordsOf(avoidSentence) : '';
  const isAvoided = c => {
    if(!avoid) return false;
    const s = wordsOf(c.s, c.a);
    return s.includes(avoid) || avoid.includes(s);
  };
  const cards = clozeFor(wordId).filter(c => !isAvoided(c));
  if(!cards.length) return null;
  const seen = store.clozeSeen(wordId);
  if(isLeech(wordId)) return trickyCard(cards.slice().sort(byAnchor), seen, store.clozeStats());
  const fresh = cards.filter(c => !seen.includes(c.id)).sort(byAnchor);
  if(fresh.length) return fresh[0];
  return seen.map(id => cards.find(c => c.id === id)).find(Boolean);
}

/* Pairs of course words close enough in meaning (or in look) that one sitting
   beside the other as a wrong pill would be a trap rather than a test. Read
   both ways. */
const CONFLICTS = {
  shelf: ['shelter'], rough: ['roughly'], tight: ['strict'], hollow: ['shallow'],
  blunt: ['rude'], eager: ['anxious'], bare: ['barely', 'spare'],
  rarely: ['barely'], slightly: ['barely'], gradually: ['eventually'],
  crack: ['gap', 'leak'], gap: ['leak'], crowd: ['crew'], crew: ['shift'],
  reward: ['wage'], realise: ['notice', 'recognise'], notice: ['recognise'],
  suppose: ['expect', 'consider'], expect: ['consider'], hesitate: ['delay'],
  lean: ['rely'], scatter: ['spill'], squeeze: ['rub'], stretch: ['drag']
};
const conflicts = (a, b) =>
  (CONFLICTS[a] || []).includes(b) || (CONFLICTS[b] || []).includes(a);

/* Two forms of one word ("rely" beside "reliable") would let the learner
   pick by spelling. A stem is the word without a trailing -e, -y or -ly. */
const stem = w => w.replace(/(ly|e|y)$/, '');
const sharesRoot = (a, b) => {
  const x = stem(a), y = stem(b);
  return x.length >= 3 && y.length >= 3 && (a.startsWith(y) || b.startsWith(x));
};

/** Three wrong pills from `pool`, in the answer's shape. Words that really
 *  are attested in this shape come first, so the pills are genuine English
 *  forms rather than ones built by rule. */
function pillsFor(pool, shape, answer){
  const attested = [], rest = [];
  for(const w of pool) (realForm(w, shape) ? attested : rest).push(w);
  return [...shuffle(attested), ...shuffle(rest)]
    .map(w => matchCase(surfaceLike(w, shape), answer))
    .filter(t => t.toLowerCase() !== answer.toLowerCase())
    .slice(0, 3);
}

/** A cloze card as a pill question. Only the word list supplies wrong pills:
 *  never a word the card says also fits, never one sharing the answer's root,
 *  never a CONFLICTS partner. The card's `rejected` words are not drawn on -
 *  their shape would point at the answer - but when a course word in the pool
 *  is one of them, its `why` is there to say what is wrong with it. */
function clozeQuestion(word, allWords, card){
  const answer = card.a;
  const shape  = shapeOf(answer, word.word);
  const alsoFits = w => card.alt.includes(w.word.toLowerCase()) ||
                        card.alt.includes(surfaceLike(w, shape).toLowerCase());
  const pool = sameClass(word, allWords).filter(w =>
    !alsoFits(w) && !sharesRoot(w.word, word.word) && !conflicts(w.word, word.word));
  return {
    kind: 'gap',
    wordId: word.id,
    cardId: card.id,
    prompt: gapOf(card.s),
    options: [answer, ...pillsFor(pool, shape, answer)],
    correctIndex: 0,
    answer,
    alt: card.alt,
    why: card.why,
    filled: filledOf(card.s, answer),
    explain: `<b>${answer}</b> — ${word.definition}`
  };
}

/** The fallback: a gap cut out of one of the word's own examples.
 *  `avoid` is a sentence the learner has just read - asking it straight back
 *  tests the last three seconds, not memory, so another one is used when the
 *  word has another one to give. */
function exampleGap(word, allWords, avoid){
  const fresh = avoid ? word.examples.filter(e => e !== avoid) : word.examples;
  const example = one(fresh.length ? fresh : word.examples);
  const answer  = surfaceOf(example);
  const shape   = shapeOf(answer, word.word);
  return {
    kind: 'gap',
    wordId: word.id,
    prompt: blankOf(example),
    options: [answer, ...pillsFor(sameClass(word, allWords), shape, answer)],
    correctIndex: 0,
    explain: `<b>${matchCase(answer, 'a')}</b> — ${word.definition}`
  };
}

/** A sentence with the word cut out of it; the pills are all in the same
 *  grammatical form so only the context tells you which one belongs. */
export function gapQuestion(word, allWords, avoid){
  const card = pickCloze(word.id, { avoidSentence: avoid });
  return card ? clozeQuestion(word, allWords, card) : exampleGap(word, allWords, avoid);
}

/* ---------- typed answers (a setting, off by default) ---------- */
const bare = s => String(s).toLowerCase().replace(/[^\p{L}\s'-]/gu, '').replace(/\s+/g, ' ').trim();

/** 'correct' for the answer, 'synonym' for a word the card says also fits,
 *  'wrong' for anything else. Case, spaces and punctuation do not count. */
function judgeTyped(q, typed){
  const t = bare(typed);
  if(t === bare(q.answer)) return 'correct';
  return q.alt && q.alt.includes(t) ? 'synonym' : 'wrong';
}

/** A cloze card was answered: remember it was met, and count how it went.
 *  outcome: 'correct' | 'wrong' | 'synonym'. */
export function recordCloze(wordId, cardId, outcome){
  store.markClozeSeen(wordId, cardId);
  return store.countCloze(cardId, outcome);
}

/* ---------- 2. Context match ---------- */
/** The word, then two sentences: its own, and one belonging to another word
 *  of the same class with this word transplanted into it. The transplant
 *  reads grammatically and means the wrong thing - which is the point. */
function matchQuestion(word, allWords){
  const good = one(word.examples);

  const donors = sameClass(word, allWords).filter(w => w.word !== word.opposite);
  const donor  = one(donors.length ? donors : sameClass(word, allWords));
  const donorExample = one(donor.examples);
  const donorSurface = surfaceOf(donorExample);
  const transplant = matchCase(
    surfaceLike(word, shapeOf(donorSurface, donor.word)), donorSurface);
  const wrong = markedOf(donorExample, transplant);

  return {
    kind: 'match',
    wordId: word.id,
    word: word.word, ipa: word.ipa, pos: word.pos,
    prompt: 'Which sentence uses it in that sense?',
    options: [markedOf(good), wrong],
    correctIndex: 0,
    explain: `<b>${word.word}</b> — ${word.definition}`
  };
}

/* ---------- 3. Intuitive focus ---------- */
/** One sentence, one claimed meaning, three seconds. Half the time the claim
 *  is the word's real meaning, half the time it belongs to another word. */
function focusQuestion(word, allWords){
  const example  = one(word.examples);
  const truthful = Math.random() < 0.5;
  const other    = one(sameClass(word, allWords));
  const claim    = truthful ? word.definition : other.definition;

  return {
    kind: 'focus',
    wordId: word.id,
    prompt: markedOf(example),
    claim,
    options: YES_NO,
    correctIndex: truthful ? 0 : 1,
    explain: truthful
      ? `<b>${word.word}</b> — ${word.definition}`
      : `<b>${word.word}</b> really means: ${word.definition}`
  };
}

/* ---------- 4. Passage-sense focus ---------- */
/** Some passages use a word in a sense its card doesn't teach - `passage.sense`
 *  carries what it actually means there (see js/data/passages.js). For those,
 *  the reading check must test *that* sense, not the card's, so it asks about
 *  the passage's own text instead of drawing a fresh sentence from the card. */
export function passageFocusQuestion(word, passage){
  const truthful = Math.random() < 0.5;
  const claim = truthful ? passage.sense : word.definition;

  return {
    kind: 'focus',
    wordId: word.id,
    prompt: passage.text,
    claim,
    options: YES_NO,
    correctIndex: truthful ? 0 : 1,
    explain: truthful
      ? `<b>${word.word}</b> here means: ${passage.sense}`
      : `<b>${word.word}</b> here actually means: ${passage.sense}`
  };
}

/* ---------- choosing a mechanic ---------- */
const MECHANICS = [gapQuestion, matchQuestion, focusQuestion];

/** Rotate through the three, so a passage never asks the same way twice in
 *  a row and the same passage is not identical on a second reading. */
export const questionFor = (word, allWords, n) =>
  MECHANICS[n % MECHANICS.length](word, allWords);

export const anyQuestion = (word, allWords) => one(MECHANICS)(word, allWords);

/* ---------- the runner ---------- */

const BODY = {
  gap:    q => `<div class="cloze">${q.prompt}</div>`,
  match:  q => `<div class="qword">${q.word}</div>
                <div class="pos">/${q.ipa}/ · ${q.pos}</div>
                <p class="muted qask">${q.prompt}</p>`,
  focus:  q => `<div class="story focus-line">${q.prompt}</div>
                <div class="claim">${q.claim}</div>
                <p class="muted qask">Does that meaning fit here?</p>`,
  choice: q => `<p class="def">${q.prompt}</p>`
};
const ROW = { gap:'pillrow', match:'sentences', focus:'pillrow', choice:'optlist' };
const OPT = { gap:'pill-opt', match:'sentence-opt', focus:'pill-opt yn', choice:'opt' };

const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' })[c]);

/** What the note under a question says. A right answer gets the word and its
 *  meaning; a cloze card missed gets the whole sentence back with the word in
 *  it, and - when the word tapped is one the card was written against - why
 *  that word does not belong. */
function noteFor(q, outcome, said){
  if(!q.cardId || outcome === 'correct') return q.explain || '';
  const why = outcome === 'wrong' && q.why && q.why[bare(said)];
  return [
    outcome === 'synonym' &&
      `Also fits: <b>${esc(said)}</b>. The target word is: <b>${q.answer}</b>.`,
    `<span class="filled">${q.filled}</span>`,
    q.explain,
    why && `<b>${esc(bare(said))}</b> — ${why}`
  ].filter(Boolean).map(line => `<div>${line}</div>`).join('');
}

/**
 * @param {HTMLElement} container
 * @param {Array} questions
 * @param {{onAnswer?:(q,ok,outcome,how)=>void, onDone:(score,total,{synonyms})=>void}} handlers
 *   outcome is 'correct' | 'wrong' | 'synonym'; a synonym is neither right nor
 *   wrong - the learner is not punished for a good word, and not credited for
 *   one they did not recall.
 *   `how` is { ms, pick, said? }: how long the question was on screen before
 *   the answer, which of `q.options` was tapped (its index before shuffling,
 *   null when typed), and what was typed, if it was.
 */
export function runQuiz(container, questions, handlers){
  let i = 0, score = 0, synonyms = 0, firstDraw = true;

  function draw(){
    // the learner left mid-quiz (the back chevron): a pending auto-advance
    // must not finish a quiz nobody is looking at - saving its result and
    // painting its score over whichever screen they went to
    if(!container.isConnected) return;
    if(i >= questions.length) return handlers.onDone(score, questions.length, { synonyms });

    // lesson comprehension questions arrive without a kind and use `question`
    const raw  = questions[i];
    const q    = { ...raw, kind: raw.kind || 'choice', prompt: raw.prompt ?? raw.question };
    const tagged = q.options.map((text, k) => ({ text, k, ok: k === q.correctIndex }));
    // Yes/No keeps its order; everything else is shuffled
    const opts = q.kind === 'focus' ? tagged : shuffle(tagged);
    // a cloze card can be typed instead of tapped, when the learner asked for it
    const typed = q.cardId && typesCloze();

    container.innerHTML = `
      <div class="top"><span class="pill">Question ${i+1} of ${questions.length}</span></div>
      <div class="card qcard">
        ${BODY[q.kind](q)}
        ${typed
          ? `<form class="typed">
               <input class="typein" autocomplete="off" autocapitalize="off" autocorrect="off"
                 spellcheck="false" enterkeyhint="done" aria-label="The missing word">
               <button class="go" type="submit">Check</button>
             </form>`
          : `<div class="${ROW[q.kind]}">
               ${opts.map((o, k) =>
                 `<button class="${OPT[q.kind]}" data-k="${k}">${o.text}</button>`).join('')}
             </div>`}
        <div class="explain" hidden></div>
      </div>`;

    // the screen itself already animated the first question in
    if(firstDraw) firstDraw = false; else easeIn(container);
    const shownAt = activeNow();

    /* Both ways of answering end here: feedback, the record, then move on. */
    function settle(outcome, said, pick = null){
      if(outcome === 'correct') score++;
      if(outcome === 'synonym') synonyms++;
      if(q.cardId) recordCloze(q.wordId, q.cardId, outcome);

      const note = container.querySelector('.explain');
      note.innerHTML = noteFor(q, outcome, said);
      note.hidden = !note.innerHTML;

      handlers.onAnswer?.(q, outcome === 'correct', outcome,
        { ms: activeNow() - shownAt, pick, ...(pick === null && { said: String(said).slice(0, 40) }) });

      // auto-advance, or sooner if they tap anywhere once they have read it
      const next = () => { container.onclick = null; clearTimeout(timer); i++; draw(); };
      const timer = setTimeout(next, outcome === 'correct' ? 1100 : 2800);
      setTimeout(() => { container.onclick = next; }, 350);
    }

    if(typed){
      const form = container.querySelector('.typed');
      const input = form.querySelector('input');
      input.focus();
      form.onsubmit = e => {
        e.preventDefault();
        if(!input.value.trim()) return;
        form.onsubmit = e => e.preventDefault();
        input.readOnly = true;
        input.blur();
        form.querySelector('button').remove();
        const outcome = judgeTyped(q, input.value);
        // the same language as the pills: a hit is confirmed, a miss steps back
        if(outcome !== 'synonym') input.classList.add(outcome === 'correct' ? 'is-right' : 'is-dim');
        settle(outcome, input.value);
      };
      return;
    }

    const buttons = [...container.querySelectorAll('[data-k]')];

    buttons.forEach(btn => btn.onclick = () => {
      const chosen = opts[+btn.dataset.k];
      buttons.forEach(b => b.onclick = null);

      if(chosen.ok){
        btn.classList.add('is-right');
      } else {
        // no red anywhere: every miss steps back, the answer steps forward
        buttons.forEach((b, k) => b.classList.add(opts[k].ok ? 'is-reveal' : 'is-dim'));
      }
      settle(chosen.ok ? 'correct' : 'wrong', chosen.text, chosen.k);
    });
  }

  draw();
}

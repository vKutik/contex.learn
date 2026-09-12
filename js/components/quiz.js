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
import { surfaceOf, blankOf, markedOf } from './word.js';
import { shuffle, one } from '../util.js';

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

/* ---------- 1. Context gap fill ---------- */
/** A sentence with the word cut out of it; the pills are all in the same
 *  grammatical form so only the context tells you which one belongs.
 *  `avoid` is a sentence the learner has just read - asking it straight back
 *  tests the last three seconds, not memory, so another one is used when the
 *  word has another one to give. */
export function gapQuestion(word, allWords, avoid){
  const fresh = avoid ? word.examples.filter(e => e !== avoid) : word.examples;
  const example = one(fresh.length ? fresh : word.examples);
  const answer  = surfaceOf(example);
  const shape   = shapeOf(answer, word.word);

  // words that really are attested in this shape come first, so the pills
  // are three genuine English forms rather than three built by rule
  const pool = sameClass(word, allWords);
  const attested = shuffle(pool.filter(w => realForm(w, shape)));
  const rest     = shuffle(pool.filter(w => !realForm(w, shape)));
  const others = [...attested, ...rest]
    .map(w => matchCase(surfaceLike(w, shape), answer))
    .filter(t => t.toLowerCase() !== answer.toLowerCase())
    .slice(0, 3);

  return {
    kind: 'gap',
    wordId: word.id,
    prompt: blankOf(example),
    options: [answer, ...others],
    correctIndex: 0,
    explain: `<b>${matchCase(answer, 'a')}</b> — ${word.definition}`
  };
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
    options: ['Yes, it fits', 'No, it does not'],
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
    options: ['Yes, it fits', 'No, it does not'],
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

/**
 * @param {HTMLElement} container
 * @param {Array} questions
 * @param {{onAnswer?:(q,ok)=>void, onDone:(score,total)=>void}} handlers
 */
export function runQuiz(container, questions, handlers){
  let i = 0, score = 0, firstDraw = true;

  function draw(){
    if(i >= questions.length) return handlers.onDone(score, questions.length);

    // lesson comprehension questions arrive without a kind and use `question`
    const raw  = questions[i];
    const q    = { ...raw, kind: raw.kind || 'choice', prompt: raw.prompt ?? raw.question };
    const tagged = q.options.map((text, k) => ({ text, ok: k === q.correctIndex }));
    // Yes/No keeps its order; everything else is shuffled
    const opts = q.kind === 'focus' ? tagged : shuffle(tagged);

    container.innerHTML = `
      <div class="top"><span class="pill">Question ${i+1} of ${questions.length}</span></div>
      <div class="card qcard">
        ${BODY[q.kind](q)}
        <div class="${ROW[q.kind]}">
          ${opts.map((o, k) =>
            `<button class="${OPT[q.kind]}" data-k="${k}">${o.text}</button>`).join('')}
        </div>
        <div class="explain" hidden></div>
      </div>`;

    // the screen itself already animated the first question in
    if(firstDraw) firstDraw = false; else easeIn(container);

    const buttons = [...container.querySelectorAll('[data-k]')];

    buttons.forEach(btn => btn.onclick = () => {
      const chosen = opts[+btn.dataset.k];
      buttons.forEach(b => b.onclick = null);

      if(chosen.ok){
        btn.classList.add('is-right');
        score++;
      } else {
        // no red anywhere: the miss just steps back, the answer steps forward
        btn.classList.add('is-dim');
        buttons[opts.findIndex(o => o.ok)].classList.add('is-reveal');
        buttons.forEach(b => { if(!b.className.match(/is-(right|reveal|dim)/)) b.classList.add('is-dim'); });
      }

      const note = container.querySelector('.explain');
      note.innerHTML = q.explain || '';
      note.hidden = !q.explain;

      handlers.onAnswer && handlers.onAnswer(q, chosen.ok);

      // auto-advance, or sooner if they tap anywhere once they have read it
      const next = () => { container.onclick = null; clearTimeout(timer); i++; draw(); };
      const timer = setTimeout(next, chosen.ok ? 1100 : 2800);
      setTimeout(() => { container.onclick = next; }, 350);
    });
  }

  draw();
}

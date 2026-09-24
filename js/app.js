/* app.js - entry point: boot, routing, and the screens that glue the
 * components together. Screens decide what to show; they never persist
 * anything themselves (storage.js) and never schedule anything (srs.js).
 */
import { words, lessons, passages, wordById, lessonWords,
         shelfOf, DAILY_BUDGET } from './data.js';
import * as store from './storage.js';
import * as srs from './srs.js';
import * as session from './session.js';
import * as settings from './settings.js';
import { progressRing, familiarityDots } from './components/progress.js';
import { renderFlashcard } from './components/flashcard.js';
import { say } from './components/audio.js';
import { pronunciations } from './data/pronunciation.js';
import { renderReview } from './components/review.js';
import { initReader, dictOf } from './components/reader.js';
import { runQuiz, questionFor, anyQuestion, gapQuestion, passageFocusQuestion } from './components/quiz.js';
import { exampleOf, markedOf, gapOf } from './components/word.js';
import { hideTooltip } from './components/tooltip.js';
import { paint, easeIn } from './components/motion.js';
import { shuffle, one, plural } from './util.js';
import { watchForNewBuild } from './fresh.js';
import { track, startTelemetry, summarize, exportLog } from './telemetry.js';
const screen = () => document.getElementById('screen');
/** The part of a screen a component renders into. */
const stageEl = () => screen().querySelector('#stage');
const DICT = dictOf(words);
/* ---------------- router ---------------- */
const routes = {};
let current = { name:'home', params:{} };
/* The one way a screen changes. Nothing outside this file calls it -
   app.js is the entry point, not a library. */
function go(name, params = {}){
  hideTooltip();
  current = { name, params };
  // a lesson is four screens under one name: say which one, and of which lesson
  track('screen', name === 'lesson' ? { name, l: params.id, st: params.stage ?? 0 } : { name });
  paint(screen(), () => routes[name](params), () => window.scrollTo(0,0));
}
/** Same screen, fresh content - a card stepping to its next example. */
const rerender = () => paint(screen(), () => routes[current.name](current.params));
/* Every screen but home starts the same way: a quiet way back, then the
   title. Back is navigation, not one of the things you came here to do, so
   it belongs in the header and not in the stack of actions at the bottom. */
const pageHead = (title, to = 'home') =>
  `<div class="pagehead">
     <button class="backlink" data-back="${to}" aria-label="Back">\u2190</button>
     <h1>${title}</h1>
   </div>`;
/* Only where leaving *is* the action: the end of a session. */
const backButton = (label = 'Back', to = 'home') =>
  `<button class="go" data-back="${to}">${label}</button>`;
const wireBack = () => screen().querySelectorAll('[data-back]')
  .forEach(b => b.onclick = () => go(b.dataset.back));
/** Wire a button on the current screen, if this render drew it. */
const on = (id, fn) => { const el = screen().querySelector('#' + id); if(el) el.onclick = fn; };
/** Every quiz answer goes into the usage log the same way: where it was
 *  asked, which mechanic (and cloze card), which word, the outcome, what was
 *  tapped or typed and how fast. A synonym is logged too - it is not a miss,
 *  but a card that keeps drawing one is a card worth reading again. */
const answered = (at, q, outcome, how, extra = {}) =>
  track('answer', { at, k: q.kind, w: q.wordId ?? null, ...(q.cardId && { card: q.cardId }),
    ok: outcome === 'correct', out: outcome, ...how, ...extra });
/** Both quizzes finish the same way: the score, a line about it, then a way
 *  back into the text. Only the wording and those buttons differ, so the
 *  caller passes them and wires their clicks afterwards. */
function scoreScreen(score, total, note, buttons){
  screen().innerHTML = pageHead(`${score} of ${total}`) + `
    <div class="card muted"><p>${note}</p></div>
    ${buttons}`;
  easeIn(screen());
  wireBack();
}
/* ---------------- home ---------------- */
routes.home = () => {
  const dueAll   = srs.dueSorted();
  const queue    = srs.reviewQueue();
  const batch    = queue.slice(0, session.SESSION_SIZE);
  const carriedOver = dueAll.length - queue.length;
  const wait     = srs.unlockIn();
  const opened   = srs.introducedIds().size;   // every word owns a shelf of texts
  const lesson   = nextLesson();
  const counts = {
    known:   srs.countStep('known'),
    read:    srs.countStep('read'),
    started: srs.countStep('started'),
    total:   words.length,
    today:   store.todayLog(),
    budget:  DAILY_BUDGET
  };
  /* Exactly one filled button, and it is the first thing that can actually
     be done. Nailing "primary" to a fixed button is how a *disabled*
     "New words in 12h" ended up the loudest element on the screen while the
     one thing you could press sat in an outline. */
  const actions = [
    batch.length && { id:'review', label:`Review ${plural(batch.length, 'word')}` },
    { id:'lesson',  label: lessonLabel(lesson, wait), off: !lesson },
    { id:'reading', label:'Reading practice', off: !opened },
    { id:'list',    label:'Word list' }
  ].filter(Boolean);
  const lead = actions.find(a => !a.off);
  screen().innerHTML = progressRing(counts) +
    (carriedOver > 0 ? `<p class="muted">${carriedOver} more due — waiting for tomorrow's budget.</p>` : '') +
    actions.map(a => `<button class="go${a === lead ? '' : ' ghost'}" id="${a.id}"${
      a.off ? ' disabled' : ''}>${a.label}</button>`).join('') +
    `<button class="linkbtn" id="settings">Settings</button>`;
  on('review',   () => go('review',  { session: session.startSession(shuffle(batch)), revealed:false }));
  on('lesson',   () => lesson && go('lesson', { id: lesson.id, stage: resumeStage(lesson) }));
  on('reading',  () => go('reading'));
  on('list',     () => go('list'));
  on('settings', () => go('settings'));
};
/** Every card of this lesson has been opened. */
const cardsDone = lesson => lesson.wordIds.every(id => store.getWord(id));

/** What to offer next. A lesson whose cards are done but whose reading or
 *  quiz is not always wins, so the daily cap can never strand you halfway.
 *  Otherwise the first lesson with an unopened word, if the cap allows it. */
function nextLesson(){
  const unfinished = lessons.find(l => cardsDone(l) && store.lessonStage(l.id) !== 'done');
  if(unfinished) return unfinished;
  if(srs.newQuota() === 0) return null;
  return lessons.find(l => !cardsDone(l)) || null;
}
/** The Learn button's label when there is nothing to resume: a countdown
 *  when the 12h window is what's holding it back, a plain reason when the
 *  review backlog is what's holding it back instead, or the finish line
 *  when there is truly nothing left to open. */
function lessonLabel(lesson, wait){
  if(lesson) return 'Learn';
  if(lessons.every(cardsDone)) return 'All words opened';
  return wait ? `New words in ${srs.hhmm(wait)}` : 'Reviews come first';
}
/** Which of the four stages to drop back into. */
function resumeStage(lesson){
  if(!cardsDone(lesson)) return 0;
  const at = STAGES.indexOf(store.lessonStage(lesson.id));
  return at < 1 ? 1 : at;          // the cards are done; carry on from there
}
/* ---------------- lesson: cards -> recall -> reading -> quiz ----------------
   The stored stage name is the one to resume at, so the order lives here and
   nowhere else; old progress saved before the recall stage existed carries
   'reading' or 'quiz' and still lands in the right place. */
const STAGES = ['cards', 'recall', 'reading', 'quiz'];
routes.lesson = ({ id, stage = 0, i = 0 }) => {
  const lesson = lessons.find(l => l.id === id);
  const ws = lessonWords(lesson);
  if(stage === 0) return lessonCards(lesson, ws, i);
  if(stage === 1) return lessonRecall(lesson, ws);
  if(stage === 2) return lessonReading(lesson);
  return lessonQuiz(lesson, ws);
};
function lessonCards(lesson, ws, i){
  const word = ws[i];
  const head = `<h1>${lesson.title}</h1>`;
  screen().innerHTML = head + '<div id="stage"></div>';
  renderFlashcard(stageEl(), word,
    { label:`New word ${i+1} of ${ws.length}`,
      fam: famOf(word.id),
      isNew: !store.getWord(word.id),
      next: i === ws.length-1 ? 'Try them from memory' : 'Got it' },
    {
      onNext: async () => {
        await srs.introduce(word.id);
        if(i === ws.length-1){ await store.setLessonStage(lesson.id,'recall');
          go('lesson',{ id:lesson.id, stage:1 }); }
        else go('lesson',{ id:lesson.id, stage:0, i:i+1 });
      },
      onRerender: rerender
    });
}
/* The lesson used to go straight from reading five cards to reading a story,
   with nothing in between asking the learner to produce anything - and being
   able to recognise a word you read a minute ago is exactly the feeling that
   fools people into thinking they know it.
   An attempt to retrieve, even a failed one, does more for retention than any
   amount of re-reading. It runs after all five cards rather than after each,
   because a test one second after reading the answer is still reading the
   answer; and it is gap fill for all five, the mechanic that comes closest to
   producing the word rather than picking it out of a line-up. */
function lessonRecall(lesson, ws){
  const questions = shuffle(ws).map(w => gapQuestion(w, words, exampleOf(w)));
  screen().innerHTML = pageHead(lesson.title) + `
    <p class="muted">Before the story: which word belongs in each sentence?
      Answer from memory — a wrong guess teaches more than another read.</p>
    <div id="stage"></div>`;
  runQuiz(stageEl(), questions, {
    onAnswer: (q, ok, outcome, how) => {
      answered('recall', q, outcome, how, { l: lesson.id });
      if(outcome !== 'synonym') store.logAnswer(ok);
    },
    onDone: async () => {
      await store.setLessonStage(lesson.id,'reading');
      go('lesson',{ id:lesson.id, stage:2 });
    }
  });
}
function lessonReading(lesson){
  screen().innerHTML = pageHead(lesson.title) + `
    <p class="muted">All five of today's words are in this text. Tap any highlighted
      word if you need its meaning.</p>
    <div class="card" id="stage"></div>
    <button class="go" id="toquiz">Answer the questions</button>`;
  initReader(stageEl(), lesson, DICT, famLevel);
  on('toquiz', async () => {
    await store.setLessonStage(lesson.id,'quiz');
    go('lesson',{ id:lesson.id, stage:3 });
  });
  wireBack();
}
function lessonQuiz(lesson, ws){
  // the story's own comprehension questions, then one of the three word
  // mechanics on a word from today - which one is left to the draw
  const questions = [
    ...lesson.quiz,
    anyQuestion(one(ws), words)
  ];
  screen().innerHTML = `<h1>${lesson.title}</h1><div id="stage"></div>`;
  runQuiz(stageEl(), questions, {
    onAnswer: (q, ok, outcome, how) => {
      answered('lesson', q, outcome, how, { l: lesson.id });
      if(outcome === 'synonym') return;          // a good word, not the word: no mark
      store.logAnswer(ok);                       // counts towards today's tally
      if(ok && q.wordId != null) store.markReadCorrect(q.wordId);
    },
    onDone: async (score, total) => {
      await store.setLessonStage(lesson.id,'done');
      track('lesson_done', { l: lesson.id, score, total });
      scoreScreen(score, total,
        score === total
          ? 'The text carried every answer. That is how words are learned outside a card.'
          : 'Read the story once more and look at the sentence around each word.',
        // the lesson is finished: carrying on is the action, re-reading the
        // fallback - so the filled button must not point backwards
        `<button class="go" data-back="home">Done</button>
         <button class="go ghost" id="again">Read the story again</button>`);
      on('again', () => go('lesson',{ id:lesson.id, stage:2 }));
    }
  });
}
/* ---------------- review ---------------- */
/* When the prompt went up and when the answer was shown: how long recall
   took, and how long the grade took after it, for the usage log. */
let promptAt = 0, revealAt = 0;
routes.review = params => {
  const { session: sess, revealed } = params;
  if(session.isFinished(sess)){
    const remembered = sess.remembered.length;
    const backTomorrow = sess.dropped.map(id => wordById(id).word);
    const more = srs.reviewQueue().slice(0, session.SESSION_SIZE);
    screen().innerHTML = pageHead('Session done') + `
      <div class="card">
        <div class="row"><span>Remembered</span><b>${remembered}</b></div>
        ${backTomorrow.length
          ? `<div class="row"><span>Back tomorrow</span><b>${backTomorrow.join(', ')}</b></div>`
          : ''}
      </div>
      ${more.length ? `<button class="go" id="more">Next ${plural(more.length, 'word')}</button>
         <button class="go ghost" data-back="home">Back</button>`
        : backButton('Back','home')}`;
    on('more', () => go('review', { session: session.startSession(shuffle(more)), revealed:false }));
    return wireBack();
  }
  const word = wordById(session.current(sess));
  if(!revealed) promptAt = Date.now();
  screen().innerHTML = '<div id="stage"></div>';
  renderReview(stageEl(), word,
    { ...session.progress(sess), revealed, fam: famOf(word.id),
      step: srs.STEP_NAME[srs.stepOf(word.id)], seen: store.getWord(word.id)?.seen || 0 },
    {
      onReveal: (mode, card) => {
        revealAt = Date.now();
        track('reveal', { w: word.id, mode, ...(card && { card }), ms: revealAt - promptAt });
        go('review', { ...params, revealed:true });
      },
      onRerender: rerender,
      onGrade: async g => {
        // a word already forgotten in this sitting is practice, not evidence
        const repeat = !!sess.misses[word.id];
        // measured before grading: what the interval was, not what it becomes
        track('grade', { w: word.id, g, ...srs.reviewContext(word.id), ms: Date.now() - revealAt,
          ...(repeat && { repeat: 1 }) });
        await srs.grade(word.id, g, { repeat });
        go('review', { session: session.answer(sess, word.id, g), revealed:false });
      }
    });
};
/* ---------------- reading on a growing interval ---------------- */
/**
 * Two different things decide what you read, and they must not be confused.
 *
 * The *schedule* decides what comes back on its own: one text per word per
 * interval, widening with every success. That is the spacing doing its job.
 *
 * Wanting to read more is not the schedule's business. A word owns ten
 * texts and you can work through all ten whenever you like - "Another text"
 * stays on this word and never touches its due date, so extra practice can
 * never cost you the spacing. Reading more is always allowed; it is simply
 * never *asked* of you.
 *
 * @param {number|null} id     show exactly this passage
 * @param {number|null} word   show a text for this word, whatever the schedule says
 * @param {number|null} after  move past this word ("Another word")
 * @param {boolean} ahead      read even though nothing is due
 */
routes.reading = ({ id = null, word: only = null, after = null, ahead = false } = {}) => {
  const due = srs.readingDue();
  const free = only !== null || ahead || id !== null;
  if(!due.length && !free) return readingRested();
  const passage = id !== null ? passages[id] : pickText(only ?? nextWord(due, after));
  if(!passage) return go('home');
  const word  = wordById(passage.w);
  track('passage', { p: passage.id, w: passage.w,
    why: id !== null ? 'again' : only !== null ? 'word' : after !== null ? 'next' : due.length ? 'due' : 'ahead' });
  const late  = srs.overdueBy(passage.w);
  const total = shelfOf(passage.w).length;
  const done  = textsRead(passage.w);
  screen().innerHTML = pageHead('Reading practice') + `
    <p class="muted"><b>${word.word}</b> · ${done >= total
        ? `all ${total} texts answered`
        : `${done} of ${total} answered`}${late > 1 ? ` · ${late} days overdue` : ''}
      ${due.length > 1 ? ` · ${due.length - 1} more waiting` : ''}</p>
    <div class="card" id="stage"></div>
    <button class="go" id="quiz">Answer the question</button>
    <button class="go ghost" id="more">Another text for <b>${word.word}</b></button>
    <button class="go ghost" id="another">Another word</button>`;
  initReader(stageEl(), passage, DICT, famLevel);
  on('quiz', () => go('readingQuiz', { id: passage.id }));
  // more of the same word: the schedule is not consulted and not moved
  on('more', () => go('reading', { word: passage.w, ahead }));
  on('another', () => go('reading', { after: passage.w, ahead }));
  wireBack();
};
/* Nothing is *due* - which is not the same as nothing to read. The schedule
   has finished asking; the shelves are still full. Say both, and make the
   reading button the plain one rather than something you have to insist on. */
function readingRested(){
  const days = srs.nextReadingIn();
  const open = [...srs.introducedIds()];
  const spare = open.reduce((n, id) => n + shelfOf(id).length - textsRead(id), 0);
  screen().innerHTML = pageHead('Reading practice') + `
    <div class="card">
      <p class="def">${days
        ? `The schedule brings the next word back ${days === 1 ? 'tomorrow' : `in ${days} days`}.`
        : 'Open some words first and their texts will start arriving here.'}</p>
      ${open.length ? `<p class="muted">Nothing is <em>due</em> - but
        ${plural(spare, 'more text')} ${spare === 1 ? 'is' : 'are'} sitting on the shelves
        of the words you have already opened. Reading them costs you nothing:
        extra practice never moves a due date.</p>` : ''}
    </div>
    ${spare ? `<button class="go" id="ahead">Keep reading</button>` : ''}`;
  on('ahead', () => go('reading', { ahead:true }));
  wireBack();
}
/** How many of a word's ten texts have had their question answered. */
const textsRead = wordId => shelfOf(wordId).filter(p => store.isPassageRead(p.id)).length;

/** The familiarity index for one word, as the dots and the marks show it. */
const famOf = id => srs.familiarity(id, textsRead(id));

/** How far a word has settled, 0-3 - what decides how loudly a passage
 *  still highlights it. */
const famLevel = id => famOf(id).level;
/* Texts already served in this sitting. A text only counts as *read* once
   its question is answered, so "have you read it" cannot order a browse
   through the shelf - this can. Deliberately not persisted: it orders one
   sitting and is forgotten, which is what keeps the shelf from repeating
   itself while you work through it. */
const shown = new Set();
/** One of the word's ten: an unread one it has not just served, at random. */
function pickText(wordId){
  if(wordId == null) return null;
  const left = shelfOf(wordId);
  if(!left.length) return null;
  // worked all the way through: start the shelf again rather than stall
  if(left.every(p => shown.has(p.id))) left.forEach(p => shown.delete(p.id));
  const unseen = left.filter(p => !shown.has(p.id));
  const unread = unseen.filter(p => !store.isPassageRead(p.id));
  const chosen = one(unread.length ? unread : unseen);
  shown.add(chosen.id);
  return chosen;
}
/** Which word to read next: the most overdue one, or - when the learner
 *  asked to move on - the one after it in the queue, so "Another word"
 *  walks the whole queue instead of bouncing between its top two. Reading
 *  ahead, with nothing due, the queue is every open word, closest to its
 *  turn first. */
function nextWord(due, after){
  const queue = due.length ? due : srs.readingOrder();
  if(!queue.length) return null;
  return queue[(queue.indexOf(after) + 1) % queue.length];
}
routes.readingQuiz = ({ id }) => {
  const passage = passages[id];
  const word = wordById(passage.w);
  // one check on the word this text belongs to; the mechanic follows the
  // text's place on the shelf, so five texts give five different angles -
  // unless this passage uses a sense its card doesn't teach, in which case
  // the check has to be about the sense the text actually showed
  const questions = [passage.sense ? passageFocusQuestion(word, passage) : questionFor(word, words, passage.slot)];
  screen().innerHTML = '<div id="stage"></div>';
  runQuiz(stageEl(), questions, {
    // getting it right from the passage alone is what turns a word amber
    onAnswer: (q, ok, outcome, how) => {
      // the rung this text was served on, before gradeReading moves it
      answered('reading', q, outcome, how, { p: passage.id, st: store.readingPlan(passage.w)?.step ?? null });
      if(outcome === 'synonym') return;          // a good word, not the word: no mark
      store.logAnswer(ok);                       // counts towards today's tally
      if(ok) store.markReadCorrect(q.wordId);
    },
    onDone: async (score, total, { synonyms }) => {
      await store.markPassageRead(passage.id);
      // right: the next text for this word moves further out. wrong: tomorrow.
      // A synonym typed in is neither, so the schedule stays where it was.
      if(!synonyms) await srs.gradeReading(passage.w, score === total);
      scoreScreen(score, total,
        score === total
          ? 'You read the meaning out of the sentences around it. That is how words are actually learned.'
          : 'Read it once more and look at what happens either side of the word.',
        `<button class="go" id="more">Another text for <b>${word.word}</b></button>
         <button class="go ghost" id="another">Next word</button>
         <button class="go ghost" id="again">Read this one again</button>`);
      on('more', () => go('reading',{ word: passage.w }));
      on('another', () => go('reading',{ after: passage.w, ahead:true }));
      on('again', () => go('reading',{ id: passage.id }));
    }
  });
};
/* ---------------- word list ---------------- */
const RANK = { started:0, read:1, known:2 };
routes.list = () => {
  const seen = words.filter(w => store.getWord(w.id))
    .sort((a,b) => RANK[srs.stepOf(a.id)] - RANK[srs.stepOf(b.id)] || a.id - b.id);
  /* Rows separated by a hairline, not a hundred bordered cards: a list is
     for scanning down, and every border the eye has to cross costs a word. */
  const body = seen.length ? `<div class="list">` + seen.map(w => `
    <div class="item">
      <div class="ihead">
        <b>${w.word}</b>
        ${familiarityDots(famOf(w.id))}
        <span class="ipos">/${w.ipa}/ · ${w.pos}</span>
        <button class="say tiny" data-say="${w.id}">🔊</button>
      </div>
      <div class="idef">${w.definition}</div>
      <div class="ex">${markedOf(w.examples[0])}${w.opposite !== '—'
        ? `<span class="anto">opposite: ${w.opposite}</span>` : ''}</div>
    </div>`).join('') + `</div>`
    : '<div class="card muted">Nothing here yet. Open your first lesson to start.</div>';
  screen().innerHTML = pageHead('Word list') + body;
  screen().querySelectorAll('[data-say]').forEach(b =>
    b.onclick = () => { const w = wordById(+b.dataset.say); say(w.id, w.word); });
  wireBack();
};
/* ---------------- settings ---------------- */
/* Nothing here is essential to the learning flow. The "Developer" card is
 * hidden until settings.registerUnlockTap() says five taps landed on the
 * title within its window - not something a learner stumbles into, but not
 * a secret either: the title says so. */
routes.settings = ({ confirming = false, note = '' } = {}) => {
  screen().innerHTML = pageHead('Settings') + `
    ${note ? `<div class="fb ok">${note}</div>` : ''}
    <div class="card">
      <h2 id="tap" class="tapzone">Vocabulary trainer</h2>
      <p class="muted">Saving to: ${store.storageLabel()}</p>
    </div>
    ${newWordsCard()}
    ${typingCard()}
    ${usageCard()}
    ${creditsCard()}
    ${settings.isDevMode() ? devCard(confirming) : ''}`;
  on('tap', () => {
    if(settings.registerUnlockTap()) go('settings', { note:'Developer mode unlocked.' });
  });
  on('plus5', async () => {
    track('grant');
    await srs.grantMore();
    go('settings', { note:`Five more words opened. ${srs.newQuota()} waiting on the home screen.` });
  });
  on('typing', () => {
    settings.setTypesCloze(!settings.typesCloze());
    go('settings');
  });
  on('devDelete', () => go('settings', { confirming:true }));
  on('devYes', async () => { track('reset'); await store.resetAll(); go('home'); });
  on('devNo', () => go('settings'));
  on('logExport', () => exportLog());
  on('logClear', () => { store.clearEvents(); go('settings', { note:'Usage log cleared.' }); });
  wireBack();
};
/* The log is the learner's, so the learner can see that it exists and take
   it away; nothing sends it anywhere by itself. */
function usageCard(){
  const n = store.eventLog().length;
  return `<div class="card">
    <h2>Usage log</h2>
    <p class="muted">What you tapped and how long it took, kept on this device
      only, to find the words and texts that give people trouble. It is never
      sent anywhere — exporting it gives you a file you can choose to share.</p>
    <div class="row"><span>Events recorded</span><b>${n}</b></div>
    <button class="go ghost" id="logExport">Export as file</button>
  </div>`;
}
/* The first things worth looking at in the log, for whoever is tuning the
   app on this device. Ids become words here; telemetry.js only counts. */
function logSummary(){
  const x = summarize(store.eventLog());
  if(!x.events) return '<p class="muted">Nothing logged yet.</p>';
  const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '—';
  const rows = (title, items) => items.length
    ? `<p class="muted">${title}</p>` + items.map(([k, v]) =>
        `<div class="row"><span>${k}</span><b>${v}</b></div>`).join('') : '';
  const lessonCount = x.funnel[0].n;
  return [
    rows('Log', [['Events', x.events], ['Sittings', x.sessions],
                 ['Since', new Date(x.since).toISOString().slice(0,10)]]),
    rows('Lessons reaching each stage', lessonCount
      ? x.funnel.map(f => [f.stage, `${f.n} · ${pct(f.n, lessonCount)}`]) : []),
    rows('Answers by mechanic', x.mech.map(m =>
      [m.k, `${pct(m.ok, m.n)} of ${m.n}${m.ms != null ? ` · ${(m.ms/1000).toFixed(1)}s` : ''}`])),
    rows('Hardest words', x.words.map(r => [wordById(r.w).word, `${r.miss} missed of ${r.n}`])),
    rows('Hardest texts', x.passages.map(r =>
      [`#${r.p} · ${wordById(passages[r.p].w).word}`, `${r.miss} missed · ${r.peek} lookups`])),
    rows('Where the tab was left', x.exits.map(r => [r.screen, r.n])),
    // an error message is whatever the browser said: show it, never run it
    rows('Recent errors', x.errors.map(r => [r.msg.replace(/[<>&]/g, c => `&#${c.charCodeAt(0)};`), r.at]))
  ].join('');
}
/* Five a batch is not a limit imposed on the learner - it is the number the
   review intervals assume, and going faster than it is what buries people in
   reviews a week later. So the button opens one more batch rather than
   raising the cap: the extra ages out on its own and the next window starts
   at five again, with no setting left switched on to forget about. */
function newWordsCard(){
  const quota = srs.newQuota();
  const wait  = srs.unlockIn();
  return `<div class="card">
    <h2>New words</h2>
    <p class="muted">Five new words per 12 hours is the pace the spacing is
      built around, and it stops handing out new words when the review
      backlog would not fit in a day. This opens five more right now without
      changing either of those — the extra batch ages out after 12 hours,
      and the window starts at five again.</p>
    <div class="row"><span>Ready to open now</span><b>${quota}</b></div>
    ${!quota && wait ? `<div class="row"><span>Next five in</span><b>${srs.hhmm(wait)}</b></div>` : ''}
    ${!quota && !wait ? `<div class="row"><span>Reviews first — budget left</span><b>${srs.budgetLeft()}</b></div>` : ''}
    <button class="go ghost" id="plus5">+5 words now</button>
  </div>`;
}
/* Typing the word is harder than picking it, and slower on a phone - so it is
   offered, never the default. A typed synonym the card accepts counts as
   neither right nor wrong. */
function typingCard(){
  const on = settings.typesCloze();
  return `<div class="card">
    <h2>Answer by typing</h2>
    <p class="muted">In gap fills, type the missing word instead of tapping it.
      A word that also fits the sentence is shown as such and does not count
      against you.</p>
    <div class="row"><span>Typing</span><b>${on ? 'on' : 'off'}</b></div>
    <button class="go ghost" id="typing">${on ? 'Go back to tapping' : 'Type answers instead'}</button>
  </div>`;
}
/* The recordings are other people's work under licences that ask for a
   credit, so the credit is in the app, not only in the README. */
function creditsCard(){
  const recordings = Object.values(pronunciations);
  const by = {};
  for(const p of recordings) by[p.by] = (by[p.by] || 0) + 1;
  const voices = Object.entries(by).sort((a,b) => b[1] - a[1])
    .map(([name, n]) => `<div class="row"><span>${name || 'uncredited'}</span>
        <b>${n}</b></div>`).join('');
  const licences = [...new Set(recordings.map(p => p.lic))].join(', ');
  return `<div class="card">
    <h2>Pronunciations</h2>
    <p class="muted">Spoken by volunteers and published on
      <a href="https://en.wiktionary.org" target="_blank" rel="noopener">Wiktionary</a>
      and Wikimedia Commons, under ${licences}. Words recorded, by speaker:</p>
    ${voices}
  </div>`;
}
/* The cards learners miss most, so the ones too open or too hard to answer
   can be rewritten in cloze_all.json. Only counts from this device. */
function worstCardsList(){
  const worst = srs.worstCards().slice(0, 10);
  if(!worst.length) return '<p class="muted">No cloze card has been shown three times yet.</p>';
  return `<div class="list">${worst.map(c => `
    <div class="item">
      <div class="ihead"><b>${Math.round(c.rate * 100)}% missed</b>
        <span class="ipos">${c.id} · shown ${c.shown}${c.synonym ? ` · ${c.synonym} synonym` : ''}</span></div>
      ${c.card ? `<div class="ex">${gapOf(c.card.s)} <i>${c.card.a}</i></div>` : ''}
    </div>`).join('')}</div>`;
}
function devCard(confirming){
  return `
    <div class="card">
      <h2>Hardest cloze cards</h2>
      ${worstCardsList()}
    </div>
    <div class="card">
      <h2>Developer</h2>
      <p class="muted">Not part of the normal flow. Deletes every word, lesson and daily
        tally on this device - there is no undo. The usage log below is kept.</p>
      ${confirming
        ? `<div class="fb no">Delete all progress? This cannot be undone.</div>
           <button class="go danger" id="devYes">Yes, delete everything</button>
           <button class="go ghost" id="devNo">Cancel</button>`
        : `<button class="go danger" id="devDelete">Delete all progress</button>`}
    </div>
    <div class="card">
      <h2>What the log says</h2>
      ${logSummary()}
      <button class="go ghost" id="logClear">Clear log</button>
    </div>`;
}
/* ---------------- boot ---------------- */
/* Progress saved by the single-file version has words but no lesson stages.
   Treat any lesson whose words are all introduced as finished, so an existing
   learner is not walked back through lessons they have already done. */
function migrateLessonStages(){
  const { lesson, words: opened } = store.snapshot();
  if(Object.keys(lesson).length || !Object.keys(opened).length) return;
  for(const l of lessons) if(cardsDone(l)) store.setLessonStage(l.id,'done');
}
await store.load();
migrateLessonStages();
startTelemetry(() => current.name);
// who opened the app, on what, carrying how much work - one line a sitting
track('open', { storage: store.storageLabel(), vw: window.innerWidth, lang: navigator.language,
  due: srs.due().length, rdue: srs.readingDue().length, opened: srs.introducedIds().size });
go('home');
watchForNewBuild();

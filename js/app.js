/* app.js - entry point: boot, routing, and the screens that glue the
 * components together. Screens decide what to show; they never persist
 * anything themselves (storage.js) and never schedule anything (srs.js).
 */
import { words, lessons, passages, wordById, lessonWords, openPassages,
         shelfOf } from './data.js';
import * as store from './storage.js';
import * as srs from './srs.js';
import * as settings from './settings.js';
import { progressRing, familiarityDots } from './components/progress.js';
import { renderFlashcard } from './components/flashcard.js';
import { say } from './components/audio.js';
import { pronunciations } from './data/pronunciation.js';
import { renderReview } from './components/review.js';
import { initReader, dictOf } from './components/reader.js';
import { runQuiz, questionFor, anyQuestion, gapQuestion, passageFocusQuestion } from './components/quiz.js';
import { exampleOf, markedOf } from './components/word.js';
import { hideTooltip } from './components/tooltip.js';
import { paint, easeIn } from './components/motion.js';
import { shuffle, one } from './util.js';
import { watchForNewBuild } from './fresh.js';
const screen = () => document.getElementById('screen');
const DICT = dictOf(words);
/* ---------------- router ---------------- */
const routes = {};
let current = { name:'home', params:{} };
/* The one way a screen changes. Nothing outside this file calls it -
   app.js is the entry point, not a library. */
function go(name, params = {}){
  hideTooltip();
  current = { name, params };
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
  const dueIds   = srs.due();
  const wait     = srs.unlockIn();
  const openIds  = srs.introducedIds();
  const reading  = openPassages(openIds);
  const lesson   = nextLesson();
  const counts = {
    known:   srs.countStep('known'),
    read:    srs.countStep('read'),
    started: srs.countStep('started'),
    total:   words.length,
    today:   store.todayLog()
  };
  /* Exactly one filled button, and it is the first thing that can actually
     be done. Nailing "primary" to a fixed button is how a *disabled*
     "New words in 24h" ended up the loudest element on the screen while the
     one thing you could press sat in an outline. */
  const actions = [
    dueIds.length && { id:'review', label:`Review ${dueIds.length} word${dueIds.length===1?'':'s'}` },
    { id:'lesson',  label: lesson ? 'Learn'
        : wait ? `New words in ${srs.hhmm(wait)}` : 'All words opened', off: !lesson },
    { id:'reading', label:'Reading practice', off: !reading.length },
    { id:'list',    label:'Word list' }
  ].filter(Boolean);
  const lead = actions.find(a => !a.off);
  screen().innerHTML = progressRing(counts) +
    actions.map(a => `<button class="go${a === lead ? '' : ' ghost'}" id="${a.id}"${
      a.off ? ' disabled' : ''}>${a.label}</button>`).join('') +
    `<button class="linkbtn" id="settings">Settings</button>`;
  const on = (id, fn) => { const el = screen().querySelector('#'+id); if(el) el.onclick = fn; };
  on('review',   () => go('review',  { queue: shuffle(dueIds), i:0, revealed:false }));
  on('lesson',   () => lesson && go('lesson', { id: lesson.id, stage: resumeStage(lesson) }));
  on('reading',  () => go('reading'));
  on('list',     () => go('list'));
  on('settings', () => go('settings'));
};
/** What to offer next. A lesson whose cards are done but whose reading or
 *  quiz is not always wins, so the daily cap can never strand you halfway.
 *  Otherwise the first lesson with an unopened word, if the cap allows it. */
function nextLesson(){
  const unfinished = lessons.find(l =>
    l.wordIds.every(id => store.getWord(id)) && store.lessonStage(l.id) !== 'done');
  if(unfinished) return unfinished;
  if(srs.newQuota() === 0) return null;
  return lessons.find(l => l.wordIds.some(id => !store.getWord(id))) || null;
}
/** Which of the three stages to drop back into. */
function resumeStage(lesson){
  if(lesson.wordIds.some(id => !store.getWord(id))) return 0;
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
  renderFlashcard(screen().querySelector('#stage'), word,
    { label:`New word ${i+1} of ${ws.length}`,
      fam: srs.familiarity(word.id, textsRead(word.id)),
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
  runQuiz(screen().querySelector('#stage'), questions, {
    onAnswer: (q, ok) => store.logAnswer(ok),
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
  initReader(screen().querySelector('#stage'), lesson, DICT, famLevel);
  screen().querySelector('#toquiz').onclick = async () => {
    await store.setLessonStage(lesson.id,'quiz');
    go('lesson',{ id:lesson.id, stage:3 });
  };
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
  runQuiz(screen().querySelector('#stage'), questions, {
    onAnswer: (q, ok) => {
      store.logAnswer(ok);                       // counts towards today's tally
      if(ok && q.wordId != null) store.markReadCorrect(q.wordId);
    },
    onDone: async (score, total) => {
      await store.setLessonStage(lesson.id,'done');
      scoreScreen(score, total,
        score === total
          ? 'The text carried every answer. That is how words are learned outside a card.'
          : 'Read the story once more and look at the sentence around each word.',
        // the lesson is finished: carrying on is the action, re-reading the
        // fallback - so the filled button must not point backwards
        `<button class="go" data-back="home">Done</button>
         <button class="go ghost" id="again">Read the story again</button>`);
      screen().querySelector('#again').onclick = () => go('lesson',{ id:lesson.id, stage:2 });
    }
  });
}
/* ---------------- review ---------------- */
routes.review = params => {
  const { queue, i, revealed } = params;
  if(i >= queue.length){
    const log = store.todayLog();
    screen().innerHTML = pageHead('Session done') + `
      <div class="card">
        <div class="row"><span>Reviewed</span><b>${queue.length}</b></div>
        <div class="row"><span>Right today</span><b>${log.right}</b></div>
        <div class="row"><span>Forgotten today</span><b>${log.wrong}</b></div>
      </div>${backButton('Back','home')}`;
    return wireBack();
  }
  const word = wordById(queue[i]);
  screen().innerHTML = '<div id="stage"></div>';
  renderReview(screen().querySelector('#stage'), word,
    { index:i, total:queue.length, revealed, fam: srs.familiarity(word.id, textsRead(word.id)) },
    {
      onReveal: () => go('review', { ...params, revealed:true }),
      onRerender: rerender,
      onGrade: async g => {
        await srs.grade(word.id, g);
        const next = { ...params, i:i+1, revealed:false };
        if(g === 0) next.queue = [...queue, word.id];   // forgotten: comes back today
        go('review', next);
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
  initReader(screen().querySelector('#stage'), passage, DICT, famLevel);
  screen().querySelector('#quiz').onclick = () => go('readingQuiz', { id: passage.id });
  // more of the same word: the schedule is not consulted and not moved
  screen().querySelector('#more').onclick = () => go('reading', { word: passage.w, ahead });
  screen().querySelector('#another').onclick = () => go('reading', { after: passage.w, ahead });
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
        ${spare} more text${spare === 1 ? '' : 's'} are sitting on the shelves of the
        words you have already opened. Reading them costs you nothing: extra
        practice never moves a due date.</p>` : ''}
    </div>
    ${spare ? `<button class="go" id="ahead">Keep reading</button>` : ''}`;
  const a = screen().querySelector('#ahead');
  if(a) a.onclick = () => go('reading', { ahead:true });
  wireBack();
}
/** How far a word has settled, 0-3 - what decides how loudly a passage
 *  still highlights it. */
const famLevel = id => srs.familiarity(id, textsRead(id)).level;

/** How many of a word's ten texts have had their question answered. */
const textsRead = wordId => shelfOf(wordId).filter(p => store.isPassageRead(p.id)).length;
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
  const chosen = one(unseen.filter(p => !store.isPassageRead(p.id)).length
    ? unseen.filter(p => !store.isPassageRead(p.id))
    : unseen);
  shown.add(chosen.id);
  return chosen;
}
/** Which word to read next: the most overdue one, or - when the learner
 *  asked to move on - the one after it in the queue, so "Another word"
 *  walks the whole queue instead of bouncing between its top two. */
function nextWord(due, after){
  if(!due.length) return anyIntroduced(after);
  if(after === null) return due[0];
  return due[(due.indexOf(after) + 1) % due.length];
}
/** Reading ahead of schedule: whichever word is closest to its turn. */
function anyIntroduced(skip = null){
  const ids = [...srs.introducedIds()].filter(id => id !== skip);
  if(!ids.length) return null;
  return ids.sort((a,b) => srs.overdueBy(b) - srs.overdueBy(a))[0];
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
  runQuiz(screen().querySelector('#stage'), questions, {
    // getting it right from the passage alone is what turns a word amber
    onAnswer: (q, ok) => {
      store.logAnswer(ok);                       // counts towards today's tally
      if(ok) store.markReadCorrect(q.wordId);
    },
    onDone: async (score, total) => {
      await store.markPassageRead(passage.id);
      // right: the next text for this word moves further out. wrong: tomorrow.
      await srs.gradeReading(passage.w, score === total);
      scoreScreen(score, total,
        score === total
          ? 'You read the meaning out of the sentences around it. That is how words are actually learned.'
          : 'Read it once more and look at what happens either side of the word.',
        `<button class="go" id="more">Another text for <b>${wordById(passage.w).word}</b></button>
         <button class="go ghost" id="another">Next word</button>
         <button class="go ghost" id="again">Read this one again</button>`);
      screen().querySelector('#more').onclick = () => go('reading',{ word: passage.w });
      screen().querySelector('#another').onclick = () => go('reading',{ after: passage.w, ahead:true });
      screen().querySelector('#again').onclick = () => go('reading',{ id: passage.id });
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
        ${familiarityDots(srs.familiarity(w.id, textsRead(w.id)))}
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
    ${creditsCard()}
    ${settings.isDevMode() ? devCard(confirming) : ''}`;
  screen().querySelector('#tap').onclick = () => {
    if(settings.registerUnlockTap()) go('settings', { note:'Developer mode unlocked.' });
  };
  screen().querySelector('#plus5').onclick = async () => {
    await srs.grantMore();
    go('settings', { note:`Five more words opened. ${srs.newQuota()} waiting on the home screen.` });
  };
  const del = screen().querySelector('#devDelete');
  if(del) del.onclick = () => go('settings', { confirming:true });
  const yes = screen().querySelector('#devYes');
  if(yes) yes.onclick = async () => { await store.resetAll(); go('home'); };
  const no = screen().querySelector('#devNo');
  if(no) no.onclick = () => go('settings');
  wireBack();
};
/* Five a day is not a limit imposed on the learner - it is the number the
   review intervals assume, and going faster than it is what buries people in
   reviews a week later. So the button opens one more batch rather than
   raising the cap: the extra ages out on its own and tomorrow starts at five
   again, with no setting left switched on to forget about. */
function newWordsCard(){
  const quota = srs.newQuota();
  const wait  = srs.unlockIn();
  return `<div class="card">
    <h2>New words</h2>
    <p class="muted">Five new words per 24 hours is the pace the spacing is
      built around. This opens five more right now without changing that —
      the extra batch ages out after a day, and tomorrow starts at five again.</p>
    <div class="row"><span>Ready to open now</span><b>${quota}</b></div>
    ${!quota && wait ? `<div class="row"><span>Next five in</span><b>${srs.hhmm(wait)}</b></div>` : ''}
    <button class="go ghost" id="plus5">+5 words now</button>
  </div>`;
}
/* The recordings are other people's work under licences that ask for a
   credit, so the credit is in the app, not only in the README. */
function creditsCard(){
  const by = {};
  for(const id in pronunciations){
    const p = pronunciations[id];
    (by[p.by] = by[p.by] || { n:0, lic:new Set() }).n++;
    by[p.by].lic.add(p.lic);
  }
  const voices = Object.entries(by).sort((a,b) => b[1].n - a[1].n)
    .map(([name, v]) => `<div class="row"><span>${name || 'uncredited'}</span>
        <b>${v.n}</b></div>`).join('');
  const licences = [...new Set(Object.values(pronunciations).map(p => p.lic))].join(', ');
  return `<div class="card">
    <h2>Pronunciations</h2>
    <p class="muted">Spoken by volunteers and published on
      <a href="https://en.wiktionary.org" target="_blank" rel="noopener">Wiktionary</a>
      and Wikimedia Commons, under ${licences}. Words recorded, by speaker:</p>
    ${voices}
  </div>`;
}
function devCard(confirming){
  return `
    <div class="card">
      <h2>Developer</h2>
      <p class="muted">Not part of the normal flow. Deletes every word, lesson and log
        on this device - there is no undo.</p>
      ${confirming
        ? `<div class="fb no">Delete all progress? This cannot be undone.</div>
           <button class="go danger" id="devYes">Yes, delete everything</button>
           <button class="go ghost" id="devNo">Cancel</button>`
        : `<button class="go danger" id="devDelete">Delete all progress</button>`}
    </div>`;
}
/* ---------------- boot ---------------- */
/* Progress saved by the single-file version has words but no lesson stages.
   Treat any lesson whose words are all introduced as finished, so an existing
   learner is not walked back through lessons they have already done. */
function migrateLessonStages(){
  if(Object.keys(store.snapshot().lesson).length) return;
  if(!Object.keys(store.snapshot().words).length) return;
  for(const l of lessons){
    if(l.wordIds.every(id => store.getWord(id))) store.setLessonStage(l.id,'done');
  }
}
await store.load();
migrateLessonStages();
go('home');
watchForNewBuild();

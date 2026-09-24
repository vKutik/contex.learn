# ContextLearn — working brief

You are working on **ContextLearn**, a vocabulary trainer for 100 English
words. It is a static site: plain ES6 modules, no framework, no build step,
no dependencies. It is served by GitHub Pages at
`https://vkutik.github.io/contex.learn/` from the `main` branch of
`vKutik/contex.learn`.

The design idea the whole thing rests on: **a word is learned from the
sentences around it, not from a card.** Cards introduce a word; real
passages from real books are what teach it. Every feature should be
judged against that.

---

## What the app does today

**Learning flow.** Five new words per rolling 12 hours, delivered as a
lesson in four stages. New words stop being handed out once the review
backlog is bigger than what fits inside the daily answer budget — the
schedule never buries a learner in the reviews it handed out itself.

1. **Cards** — word, IPA, a human recording, definition, one example,
   an antonym, and a familiarity indicator. Five cards. The very first time
   a word is met, its `plain` line — a wordless retelling of the first
   example — sits under the definition, so an abstract word gets a picture.
2. **Recall** — five gap fills, one per word, before the story. This is a
   retrieval attempt, and it deliberately avoids the sentence the card just
   showed.
3. **Reading** — one short text using all five words. Tapping a highlighted
   word opens a tooltip with its transcription, a speaker button and its
   meaning; the text does not move.
4. **Quiz** — the story's own comprehension questions plus one generated
   check on a word from today.

**Reading practice.** Every word owns a shelf of **ten** passages. The
schedule brings one word back per interval (1, 3, 7, 16, 35, 90, 180 days,
resetting to the first rung on a miss). Separately from the schedule, the
learner can always read more: *Another text for `<word>`* walks that word's
shelf without touching its due date, and *Another word* walks the due queue.

**Review.** Classic spaced repetition on the cards: recall prompt, reveal,
then one of four grades (Forgot / Hard / Good / Easy) which sets the next
due date from `STEPS` (1, 3, 7, 16, 35, 90 days). The prompt alternates
between a cloze card and "what does this word mean". Reviews come in
sittings of seven (`session.js`): the "Done x of 7" counter only goes up, a
Forgot comes back three cards later rather than last (never with fewer than
two others between — with fewer left it waits for tomorrow), a second Forgot
sends the word to tomorrow, and a sitting stops after 20 answers. A word
forgotten earlier in the same sitting is practice from then on: it climbs to
box 1 at most, and adds nothing to `right`, `wrong` or the day's tally. The due queue
is capped by the daily answer budget (`DAILY_BUDGET`, 80); what does not fit
waits at the front of tomorrow's.

**Three generated quiz mechanics**, all built from the word list at run time
so they never go stale:

| Mechanic | What you see | What it checks |
|---|---|---|
| `gapQuestion` | a hand-written cloze card (see below), 3–4 word pills | whether the context tells you which word belongs |
| `matchQuestion` | the word, then two sentences — its own and another word's with this one transplanted in | the sense, not the shape |
| `focusQuestion` | one sentence, one claimed meaning, yes/no | a three-second calibration |

**Cloze cards.** Every gap fill — recall, the reading check's gap mechanic,
and the review screen's "which word is missing" — asks one of the word's
five hand-written cards (`js/data/cloze.js`, generated from `cloze_all.json`
by `tools_cloze.py`). `pickCloze` in `quiz.js` is the only place a card is
chosen: never the sentence just read, a card not met yet in the order
definition → consequence → cause → contrast → collocation, then the one met
longest ago. Wrong pills never include a word the card's `alt` accepts, one
sharing the answer's root, or a `CONFLICTS` neighbour. A miss shows the
sentence filled in, the definition and — when the tapped word is one the
card was written against — its `why`. Typing the answer is a setting, off by
default; a typed `alt` word counts as neither right nor wrong. The developer
card lists the most-missed cards (`srs.worstCards`). A word with no cards
falls back to a gap cut out of its examples.

**Progress.** A gauge whose percentage is the *whole journey*: a word is
worth ⅓ for being opened, ⅔ once proved inside a passage, and the whole of
it at box 4. Under it, the day's answer tally. Beside each word, a
three-dot familiarity index whose last dot cools when the word is overdue.

**Usage log.** Every answer, reveal, grade, tooltip lookup and screen is
appended to a local event log, so where learners struggle can be read
instead of guessed. It never changes learning and never leaves the device:
Settings shows it and exports it as a file; the developer card summarises it.
See "Usage log" below.

**Other.** 100 human pronunciation recordings from Wiktionary, served from
the repo and loudness-matched. A `+5 words now` button in Settings. A
developer card behind five taps on the Settings title. A stale-build
detector that reloads a tab running replaced code.

---

## Structure

```
index.html                 markup only: the screen shell
version.txt                the deployed build id (see "Deploying")
tools_stamp.py             writes the build id into js/build.js + version.txt
cloze_all.json             the cloze cards, source of truth: 100 words x 5
tools_cloze.py             validates it and writes js/data/cloze.js
passages_audit.json        a judged score for every passage, tied to its text by hash
tools_passages.py          the passage quality report and bar (see "Passage quality")
.nojekyll                  REQUIRED — see "Deploying"
audio/                     100 pronunciation recordings, one per word
tests/                     the deploy gate; not served, not part of the app
  run.mjs                  one command, one exit code
  helpers/                 isolation, seeding, the static server, Playwright
  unit/ data/ deploy/ e2e/ the four suites
styles/
  main.css                 tokens, page, typography, motion, transitions
  components.css           buttons, cards, gauge, quiz options, word rows
  reading.css              passage text, <mark> levels, tooltip
  _font.css                embedded Inter subset
js/
  app.js                   entry point: boot, router, every screen
  data.js                  the data contract (re-exports + helpers)
  storage.js               the ONLY module that persists progress
  srs.js                   scheduling rules, no DOM
  session.js               one review sitting's rules, no DOM
  settings.js              app preferences, the developer unlock
  telemetry.js             the usage log: track(), error capture, summary, export
  util.js                  shuffle, one, dayKey, plural
  fresh.js                 reloads a tab running a replaced build
  build.js                 generated: the build id
  data/
    words.js               100 words
    lessons.js             20 lessons
    passages.js            1000 passages, ten per word
    pronunciation.js       recording, speaker and licence per word
    cloze.js               500 cloze cards - GENERATED, edit cloze_all.json
  components/
    progress.js            the gauge, the legend, familiarity dots
    word.js                the {braces} marker + the shared card face
    flashcard.js           stage 1
    reader.js              paints a passage, hangs tooltips
    tooltip.js             one tooltip at a time, positioned and flipped
    quiz.js                the three mechanics and the runner
    audio.js               plays the recording, falls back to speech
    motion.js              how a screen arrives
    review.js              the spaced-repetition screen
```

### Data contracts

```js
word     { id, word, pos, ipa, translation, definition, opposite, examples[], plain? }
lesson   { id, title, wordIds[5], text, quiz[] }
passage  { id, w, slot, also[], text, sense?, source }
question { type, question, options[], correctIndex }      // lesson quiz
cloze    { id: 'wordId:n', s, a, t, alt[], why{} }        // cloze.js[wordId][n]
```

- An example marks its target word in braces: `"the water was {shallow}"`.
  **Only `js/components/word.js` may read that convention.**
- A lesson's `text` and a passage's `text` carry
  `<mark data-word="shallow">shallow</mark>`. Every `data-word` must exist
  as a headword in `words.js`.
- `passage.w` is the word the passage belongs to; `slot` is 0–9 on that
  word's shelf; `also` lists other course words it happens to contain.
- `passage.sense` is set only when this passage's own word is used in a
  sense the card doesn't teach; the tooltip and the reading check show it
  instead of the card's definition. See "Passage quality".

### Persisted state (`localStorage`, key `vocab-progress`)

```
words  { [wordId]: { box, right, wrong, seen, new, next, lastSeen } }
ex     { [wordId]: index of the example last shown }
rw     { [wordId]: 1 }        proved correct from inside a passage
read   { [passageId]: 1 }
lesson { [lessonId]: 'recall' | 'reading' | 'quiz' | 'done' }
rsched { [wordId]: { step, next } }   when this word is next due a text
log    { 'YYYY-MM-DD': { right, wrong } }   keyed by the learner's local day
grants [ timestamp ]          each "+5 words" tap, one extra batch apiece
clozeSeen  { [wordId]: [cardId] }   last five cloze cards met, oldest first
clozeStats { [cardId]: { shown, correct, wrong, synonym } }
```

A second key, `vocab-events`, holds the usage log (also only via
`storage.js`): `{ uid, events: [...] }`, at most 3000 events, oldest dropped.

### Usage log

Every event is `{ t, s, b, e, ...fields }` — time in ms, page session,
build id, event name. Written by `telemetry.js`'s `track()`.

| `e` | fields | where |
|---|---|---|
| `open` | `storage, vw, lang, due, rdue, opened` | boot |
| `screen` | `name`, and `l, st` for a lesson stage | every `go()` |
| `answer` | `at` (recall/lesson/reading), `k` (mechanic), `w, ok, out` (correct/wrong/synonym), `ms, pick`, `said` when typed, `card` for a cloze card, `l` or `p, st` | every quiz answer |
| `lesson_done` | `l, score, total` | end of a lesson quiz |
| `reveal` | `w, mode` (cloze/meaning), `card` if a cloze card, `ms` | review, "Show answer" |
| `grade` | `w, g, box, elapsed, overdue, ms` — measured *before* the grade; `repeat: 1` when the word was already forgotten in this sitting | review |
| `passage` | `p, w, why` (due/word/next/ahead/again) | a text is served |
| `peek` | `w`, and `p` (passage) or `l` (lesson) | tooltip opened |
| `say` / `audio_fail` | `w` | speaker |
| `grant`, `reset`, `export` | — | Settings |
| `leave` | `screen` | tab hidden |
| `stale_reload` | `to` | fresh.js |
| `error` | `msg, at, stack` | uncaught error or rejection, 20 a sitting |

`pick` is the tapped option's index in `q.options` before shuffling (null
when the answer was typed), so `q.correctIndex` (0 for every generated
mechanic) says whether and what it missed. The log is never read by `srs.js`; a progress reset leaves it alone.
Nothing in `js/` may reach the network except `fresh.js`'s version check —
`deploy/` enforces it. Sending the log to a server is a future, separate step.

---

## Rules — follow these

**Architecture**

1. **One way to save.** Only `storage.js` touches `localStorage`. Screens
   and components call its mutators; they never read or write storage
   directly.
2. **`srs.js` has no DOM.** It reads a snapshot and writes back through
   `storage.js`, so the scheduling logic can move to a server untouched.
3. **JSON-first.** No word, sentence, question or definition is written
   into a view. Everything comes from `js/data/`.
4. **DRY.** Before adding a helper, check whether it exists: `util.js` for
   arrays, the learner's calendar day and plurals, `word.js` for the
   `{braces}` marker and the shared card face, `motion.js` for screen
   transitions, `quiz.js` for question generation.
   Every export in `js/` is imported by something — keep it that way. The
   three `fetch*` functions in `data.js` are the deliberate exception: they
   are the seam for a future backend.
5. **No dependencies, no build step, no framework.** If a change seems to
   need one, say so rather than adding it.

**Interface**

6. **One filled button per screen, and it is one that can be pressed.**
   Primary is assigned to the first *actionable* thing, never nailed to a
   fixed button. Everything else is `.go.ghost`.
7. **Back is not an action.** It is the chevron in `pageHead()`, never a
   full-width button in the stack.
8. **A disabled control leaves the hierarchy** rather than shouting at low
   opacity.
9. **Feedback is never punitive.** A miss does not flash red: the tapped
   option dims, the right answer lifts in amber, and a line says what the
   word means.
10. **One tap is the answer.** No radio buttons, no submit buttons, no
    keyboard input in the learning flow. The one exception is typed cloze
    answers, a setting the learner has to switch on; off by default, the
    flow stays one tap.
11. **Lists are rows with hairlines, not cards.** Do not nest a bordered,
    filled block inside a bordered card.

**Learning**

12. **Extra practice never moves a due date.** The schedule decides what
    comes back by itself; it does not decide what the learner is allowed to
    read. Keep those separate.
13. **The daily cap is not raised permanently.** `+5 words` grants one
    extra batch that ages out of the same rolling 12 hours.
14. **Reading only recolours a word.** It never changes its review due
    date — that is the review screen's job alone.
15. **Signalling steps back.** `<mark>` fades across the four familiarity
    levels; a word already known does not need finding.

---

## Working on it

**Run it.** ES6 modules need HTTP; `file://` is blocked.

```bash
python3 -m http.server 8000     # then open http://localhost:8000
```

**Test it in a real browser, not by reasoning.** Chromium and Playwright
are available. Drive every screen you touched and assert on what the page
actually renders. Measure claims before making them — several bugs in this
codebase survived because they looked correct in the source.

**Run the gate before every deploy.**

```bash
node tests/run.mjs            # 287 tests, about 25 seconds
```

Four suites, cheapest first: `unit/` for the logic, `data/` for the contract
`js/data/` has to keep, `deploy/` for "would this tree work on Pages", `e2e/`
for the app as a learner meets it, in real Chromium. Green is the condition
for pushing. A new feature arrives with its tests; `tests/README.md` has the
rules for writing them, the first of which is that a test run can never reach
a learner's saved progress.

`deploy/` already checks both traps below, but knowing why they are there is
still the difference between fixing one and re-discovering it.

**Deploying — two traps that cost real debugging time:**

- **`.nojekyll` must exist.** GitHub Pages runs the repo through Jekyll,
  which silently drops every file whose name starts with an underscore.
  Without it, `styles/_font.css` 404s and the font never loads — on the
  live site only.
- **Run `python3 tools_stamp.py` before committing any change to the app.**
  It writes the same build id into `js/build.js` and `version.txt`.
  `fresh.js` compares them and reloads a tab that is running replaced code;
  if the two drift apart the check is useless.

**Git.** Develop on the session's `claude/…` branch, then fast-forward
`main` and push both — `main` is what Pages serves. Do not open pull
requests unless asked.

**Editing cloze cards.** Change `cloze_all.json`, then run
`python3 tools_cloze.py`; never edit `js/data/cloze.js` by hand. The script
refuses a card that breaks the schema (one `____`, 8–16 words, blank not in
the first two, five cards with five different anchors, `alt` never holding
the answer), and `tests/data/cloze.test.mjs` fails if the module and the
JSON drift apart.

---

## Passage quality

The corpus began as 932 extracts mined from 101 public-domain books, filtered
by rule, plus 68 written for the course. The filters could not read, and
reading them showed that roughly 40% used their word in a sense the card does
not teach (`stretch`: 0 of 10 — all "stretched out his legs"; `bolt`: door
bolts; `crack`: a gap to peep through), and many more were fragments cut off
at "Mr.", Victorian dialect, or a word the text gave no way to work out.

Every passage has now been read and scored 0–2 on four questions, recorded in
`passages_audit.json` next to a hash of the exact text:

| | question | 2 | 1 | 0 |
|---|---|---|---|---|
| **S** | is it the card's sense? | the card's sense and part of speech | a common neighbouring sense, labelled with `sense` | another sense, another part of speech |
| **C** | can the word be worked out from the text? | a consequence, contrast or explanation points at it | the text fits, but would fit other words too | nothing to go on |
| **R** | can an A2–B1 reader read it? | plain modern English | literary but manageable | archaic, dialect |
| **A** | does it stand alone? | yes | some unexplained names | starts or stops mid-thought |

The bar: S = 2 (or S = 1 with a `sense` label), nothing below 1, C + R + A ≥
4, and at least 7 of every shelf's 10 in the card's own sense. Passages below
it were rewritten, as short everyday scenes whose context gives the meaning
away, or — where a small cut fixed it — trimmed at a sentence boundary. The
result is 312 book extracts and 688 written passages; 988 in the card's sense,
12 in a labelled neighbouring sense, none in a wrong one.

`python3 tools_passages.py` prints the report (`… stretch` shows one shelf),
and `tests/data/passages.test.mjs` holds the bar in the gate. S cannot be
computed, so it is a judgement; what can be measured — leftover `_italics_`,
an excerpt cut off at a title, unbalanced quotes, a 45-word sentence — is
measured and overrules a generous judgement. **Editing a passage breaks its
hash and fails the gate until it has been read and scored again**; then
`python3 tools_passages.py --stamp`. Do not ship a mechanism that makes the
learner do this judging: an earlier "this text is unclear" button did exactly
that and was removed.

One problem is still open: for some words the definition on the card is not
the sense books mostly use (`stretch`, `bolt`, `shift`). The shelves now teach
the card; whether the cards should change is the owner's decision.

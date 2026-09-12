# ContextLearn — working brief

You are working on **ContextLearn**, a vocabulary trainer for 100 English
words. It is a static site: plain ES6 modules, no framework, no build step,
no dependencies. It is served by GitHub Pages at
`https://vkutik.github.io/read.words/` from the `main` branch of
`vKutik/Cards-`.

The design idea the whole thing rests on: **a word is learned from the
sentences around it, not from a card.** Cards introduce a word; real
passages from real books are what teach it. Every feature should be
judged against that.

---

## What the app does today

**Learning flow.** Five new words per rolling 24 hours, delivered as a
lesson in four stages:

1. **Cards** — word, IPA, a human recording, definition, one example,
   an antonym, and a familiarity indicator. Five cards.
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
due date from `STEPS`.

**Three generated quiz mechanics**, all built from the word list at run time
so they never go stale:

| Mechanic | What you see | What it checks |
|---|---|---|
| `gapQuestion` | a sentence with the word cut out, 3–4 word pills | whether the context tells you which word belongs |
| `matchQuestion` | the word, then two sentences — its own and another word's with this one transplanted in | the sense, not the shape |
| `focusQuestion` | one sentence, one claimed meaning, yes/no | a three-second calibration |

**Progress.** A gauge whose percentage is the *whole journey*: a word is
worth ⅓ for being opened, ⅔ once proved inside a passage, and the whole of
it at box 4. Under it, the day's answer tally. Beside each word, a
three-dot familiarity index whose last dot cools when the word is overdue.

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
.nojekyll                  REQUIRED — see "Deploying"
audio/                     100 pronunciation recordings, one per word
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
  settings.js              app preferences, the developer unlock
  util.js                  shuffle, one
  fresh.js                 reloads a tab running a replaced build
  build.js                 generated: the build id
  data/
    words.js               100 words
    lessons.js             20 lessons
    passages.js            1000 passages, ten per word
    pronunciation.js       recording, speaker and licence per word
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

`vocab-trainer.html` at the root is the superseded single-file original. It
is not part of the app and nothing references it.

### Data contracts

```js
word     { id, word, pos, ipa, translation, definition, opposite, examples[] }
lesson   { id, title, wordIds[5], text, quiz[] }
passage  { id, w, slot, also[], text, sense?, source }
question { type, question, options[], correctIndex }      // lesson quiz
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
  instead of the card's definition. See "Known open problem — polysemy".

### Persisted state (`localStorage`, key `vocab-progress`)

```
words  { [wordId]: { box, right, wrong, seen, new, next, lastSeen } }
ex     { [wordId]: index of the example last shown }
rw     { [wordId]: 1 }        proved correct from inside a passage
read   { [passageId]: 1 }
lesson { [lessonId]: 'recall' | 'reading' | 'quiz' | 'done' }
rsched { [wordId]: { step, next } }   when this word is next due a text
log    { 'YYYY-MM-DD': { right, wrong } }
grants [ timestamp ]          each "+5 words" tap, one extra batch apiece
```

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
   arrays, `word.js` for the `{braces}` marker and the shared card face,
   `motion.js` for screen transitions, `quiz.js` for question generation.
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
    keyboard input in the learning flow.
11. **Lists are rows with hairlines, not cards.** Do not nest a bordered,
    filled block inside a bordered card.

**Learning**

12. **Extra practice never moves a due date.** The schedule decides what
    comes back by itself; it does not decide what the learner is allowed to
    read. Keep those separate.
13. **The daily cap is not raised permanently.** `+5 words` grants one
    extra batch that ages out of the same rolling 24 hours.
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

**Deploying — two traps that cost real debugging time:**

- **`.nojekyll` must exist.** GitHub Pages runs the repo through Jekyll,
  which silently drops every file whose name starts with an underscore.
  Without it, `styles/_font.css` 404s and the font never loads — on the
  live site only.
- **Run `python3 tools_stamp.py` before committing any change to the app.**
  It writes the same build id into `js/build.js` and `version.txt`.
  `fresh.js` compares them and reloads a tab that is running replaced code;
  if the two drift apart the check is useless.

**Git.** Develop on `claude/commit-and-push-4t5e0k`, then fast-forward
`main` and push both. Do not open pull requests unless asked.

---

## Known open problem — polysemy

The corpus is 932 extracts mined from 101 public-domain books, filtered by
rule, plus 68 written for the course. The
filters cannot read, and the measured result is that **roughly 40% of
passages use their word in a sense the card does not teach**. Read samples,
not summaries:

| word | the card teaches | passages that show it |
|---|---|---|
| `stretch` | become longer by pulling | **0 of 10** — all are "stretched out his legs" |
| `bolt` | a metal pin | **1 of 10** — six are door bolts, three the verb |
| `crack` | a thin line where something is broken | 3 of 10 — seven are a gap to peep through |
| `shift` | a period of work | 3 of 10 — five are the verb, one a garment |

Three separate problems are tangled here: the wrong part of speech (which
is mechanically checkable and was never checked), an adjacent sense, and a
different sense. A fourth, and probably the worst: for some words **the
definition on the card is not the sense the language actually uses**.

Any real fix needs per-passage sense labelling, which rules cannot do — a
language model reading all 1000 passages at build time can. **Do not ship a
mechanism that makes the learner do that labelling**; an earlier "this text
is unclear" button did exactly that and was removed. The direction is the
owner's decision and is still open.

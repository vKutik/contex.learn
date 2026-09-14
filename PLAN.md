# ContextLearn — Word Selection Pipeline

> This document is both project documentation and context for LLMs.
> When asking a model for help, paste this file first, then your question.

I'm building ContextLearn, a vocabulary trainer web app for learning English
words in context. My English level is A2-B1. My goal is **reading books**, not
speaking.

## Constraints

- Static site: plain ES6 modules, no framework, no build step, no dependencies,
  no server. Hosted on GitHub Pages.
- Everything must work offline in the browser.
- 2-3 hours per week available for this project.
- A local LLM (7-8B, quantized) runs on an RTX 3060 12GB for **one-time offline
  preprocessing only**. It never runs at app runtime.

## The pipeline

1. **Pick a public-domain book** (Project Gutenberg, plain `.txt`).
   Difficulty is measured by Flesch Reading Ease (`textstat`), plus the share of
   its words that fall outside Oxford 3000.

2. **Count word frequency in that book.** The word list comes from the book
   itself, not from an abstract level list. Words learned are words that will
   actually appear on the page.

3. **Filter against Oxford 3000.** This removes book-specific junk (archaic
   words, dialect) and keeps words that stay useful in the next book.

4. **Subtract known words.** Method: an "I know this" button in the app that
   removes the word permanently, so the list cleans itself during the first
   sessions. No manual pre-tagging of 1500 words.

5. **Take the top ~300 by frequency.** Only those get learned.

6. **Sense-tag the polysemous ones.** Of those 300, roughly 40 have more than
   one meaning (`run`, `get`, `take`, `way`, `hold`). Only these go to the local
   LLM. Single-sense words skip this step entirely — this is what keeps the
   preprocessing run at minutes instead of hours.

7. **The learning unit is word + sense, not word.** `run` becomes five separate
   objects (`run__manage`, `run__move-fast`, ...), each with its own
   spaced-repetition interval. Knowing "to move fast" says nothing about knowing
   "to be in charge of a business".

8. **Drop rare senses.** Within each polysemous word, discard senses that occur
   only once or twice in the book. Sense frequency decides.

## Data model

Static JSON in the repo, read-only:

```json
{
  "word": "run",
  "sense_id": "run__manage",
  "definition": "to be in charge of a business or organization",
  "contexts": [
    { "text": "He runs a small shop near the river.", "start": 3, "end": 7 }
  ]
}
```

- `definition` — simple English, not a translation.
- `contexts` — 3-5 passages per sense. One passage teaches the paragraph, not
  the word.
- `start` / `end` — character offsets for highlighting. Position-based, so
  `brunch` and `running` don't produce false matches.

User progress lives separately in **localStorage** — not cookies (4KB is too
small), not in the JSON (that file is shared and read-only). IndexedDB later,
when the app scales to full books.

## Design principle

A word is learned from the sentences around it, not from a flashcard.

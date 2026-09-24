# Tests — the deploy gate

```bash
node tests/run.mjs                 # everything: 258 tests, about 20 seconds
node tests/run.mjs unit            # one suite: unit | data | deploy | e2e
node tests/run.mjs --no-browser    # skip Chromium (does not count as a full pass)
```

Run the whole thing before every deploy. Green is the condition for pushing;
red is not something to interpret.

Node 22 or newer, because the app is ES modules in `.js` files with no
`package.json` to declare it and older Node cannot work that out. The app
itself has no such requirement — it runs in any browser with ES modules.

---

## What the four suites are for

| suite | how many | needs | what it protects |
|---|---|---|---|
| `unit/` | 127 | nothing | the logic: scheduling, one review sitting, storage, the braces convention, the three quiz mechanics, which cloze card is asked and what sits beside it, the gauge |
| `data/` | 30 | nothing | the contract every screen assumes about `js/data/` — ids, shelves, marks, recordings, cloze cards and their sync with `cloze_all.json` |
| `deploy/` | 23 | nothing | would this tree work on Pages: the two traps, every asset, every import, the architecture rules |
| `e2e/` | 78 | Chromium | the app as a learner meets it: five screens, driven by tapping |

The order is deliberate: a missing build stamp or a broken passage fails in
under a second, before Chromium has started.

`e2e/harness.html` is a bare page for driving one component on its own. It is
not part of the app: `index.html` never references it and nothing in `js/`
knows it exists.

---

## The rules

**Safety — a test run must never cost anyone their progress**

1. **No test writes to a real profile.** Under Node there is no
   `localStorage`, so `storage.js` keeps its state in memory and
   `storageLabel()` reads `NOT SAVING` — `unit/storage.test.mjs` asserts
   exactly that, and it is the first thing to fix if it ever fails. In the
   browser every page gets a throwaway context that is destroyed with the
   test.
2. **Nothing under `tests/` is loaded by the app**, and nothing in `js/` or
   `index.html` may reference it. `deploy/release.test.mjs` checks both
   directions.
3. **The app gains no dependency.** Only Node built-ins. Playwright is a
   developer tool: when it is missing the browser suites skip, and
   `run.mjs` then fails loudly rather than reporting a green run that never
   opened a page.
4. **Tests read the working tree; they never write to it.** No fixture files,
   no temp copies of the app, no stamping, no git.

**Determinism — a test that fails at random teaches people to ignore it**

5. **Never assert a random outcome.** The quiz mechanics draw at random, so
   assert what must hold for *every* draw and loop over all 100 words. If an
   assertion needs a particular draw, force it with `withRandom` from
   `helpers/fixture.mjs`.
6. **Restore whatever you patch.** `withRandom` and `withClock` put
   `Math.random` and `Date.now` back in a `finally`, so one file can never
   leak a rigged clock into the next.
7. **Wait for a condition, not for a duration.** The one deliberate exception
   is the 400 ms in `helpers/browser.mjs`, which waits out a timing the app
   itself defines (the quiz runner arms tap-to-advance at 350 ms).
8. **Arrange state, do not click your way to it.** `helpers/seed.mjs` writes
   the starting progress in the shape `storage.js` persists, so a test about
   the reading ladder does not spend two minutes doing a lesson first.
9. **Dates are relative.** `dateIn(3)`, `daysAgo(1)` — never a literal
   `'2026-09-12'`, which passes today and fails in March.

**Worth — a test that cannot fail is worse than no test**

10. **Break the code and watch it go red.** Every check here was confirmed by
    injecting the regression it claims to catch: deleting `.nojekyll`,
    drifting the build stamp, mistyping a `data-word`, shortening `STEPS`,
    making reading move a review date.
11. **Do not reimplement the app inside the test.** An early version of
    `unit/quiz.test.mjs` recomputed the app's own shape rule and failed on
    "anxious" — a base adjective that merely ends in *s*. Assert the outcome
    a learner would notice instead.
12. **When a test goes red, find out which side is wrong** before touching
    either. Half the failures written down above were the test's fault; the
    other half would have shipped.
13. **Assert what the page renders**, not what the source says. Several bugs
    in this codebase survived because they looked correct in the source.

**Keeping it useful**

14. **A new feature arrives with its tests**, in whichever of the four
    suites apply: new data → `data/`; new rules → `unit/`; a new screen or a
    new tap → `e2e/`; a new file, asset or architectural boundary →
    `deploy/`.
15. **Name the test after the promise it keeps**, not after the function it
    calls. `reading never moves a review due date` says what breaks; `test
    gradeReading` does not.
16. **Keep the whole gate under a minute.** It is only run before every
    deploy if it is quick enough to be run before every deploy.

---

## What `deploy/` checks, in one list

- `.nojekyll` exists — without it Pages drops `styles/_font.css` and the font
  404s on the live site only.
- `js/build.js` and `version.txt` carry the same id, and it looks stamped —
  while they disagree, `fresh.js` reloads every tab forever.
- Every asset `index.html` asks for is committed; every module import
  resolves; every `@import` resolves; every recording is on disk and every
  file in `audio/` is played by something.
- No `package.json`, no `node_modules`, no CDN import, no bare specifier, no
  extensionless import.
- Only `storage.js` and `settings.js` touch web storage, and only
  `storage.js` knows the progress key.
- `srs.js`, `util.js` and `data.js` never reach for the browser.
- Only `word.js` reads the `{braces}` convention.
- Every export is imported by something, bar the three documented `fetch*`
  seams in `data.js`.
- No `console.log` and no `debugger` in anything the browser loads.

The greps behind those last few run over `helpers/paths.mjs`'s `codeOnly()`,
which blanks comments and string literals first — `js/data/passages.js` is a
thousand sentences of English and contains the words *window* and *console*
inside quoted prose.

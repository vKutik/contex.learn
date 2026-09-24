#!/usr/bin/env python3
"""Score every reading-practice passage and hold the corpus to a quality bar.

    python3 tools_passages.py              the report; exit 1 if anything fails
    python3 tools_passages.py stretch      one word's shelf, passage by passage
    python3 tools_passages.py --stamp      after an edit: re-hash the audit

A passage teaches a word only if a learner at A2-B1 can read it and work the
word out from it. That is four questions, and a passage is scored 0-2 on each:

  S  sense       2 the card's sense and part of speech
                 1 a common neighbouring sense, labelled with `sense` so the
                   tooltip and the reading check show that one instead
                 0 another sense, another part of speech, or a name
  C  context     2 the text around the word tells you what it means
                   (a consequence, a contrast, an explanation, a result)
                 1 the text fits the word but would fit others as well
                 0 nothing to go on, or it points the wrong way
  R  readable    2 plain modern English
                 1 literary but manageable: long sentences, a few old words
                 0 archaic, dialect, or syntax that has to be decoded
  A  alone       2 makes sense without the book it came from
                 1 some unexplained names, the reader can still follow
                 0 an excerpt that starts or stops mid-thought

S cannot be computed - rules cannot tell a door bolt from a metal pin - so
S, C, R and A are judgements, read passage by passage and kept in
passages_audit.json next to a hash of the text they were made about. Editing
a passage without re-reading it leaves a stale hash, and this script fails
until the judgement is made again (then --stamp).

What *can* be computed is checked here as well, and it overrules a generous
judgement: markup left over from the source (_italics_), an excerpt cut off at
"Mr.", old forms (thee, hath, 'em), a target buried in a compound
("shallow-pated"), sentences too long to hold in the head.

The bar a passage has to clear:
  S = 2, every other score at least 1, C + R + A >= 4          or
  S = 1 with a `sense` label, every other score at least 1, C + R + A >= 4
and a shelf has to clear it too: at least 7 of its 10 passages in the
card's own sense, because the learner came to learn that one.
"""
import hashlib, json, pathlib, re, sys
from collections import Counter

root = pathlib.Path(__file__).parent
AUDIT = root / 'passages_audit.json'

def module_rows(name):
    """The data modules are one JSON object per line - read them as such."""
    rows = []
    for line in (root / 'js' / 'data' / name).read_text(encoding='utf-8').splitlines():
        line = line.strip().rstrip(',')
        if line.startswith('{"id"'):
            rows.append(json.loads(line))
    return rows

words = {w['id']: w for w in module_rows('words.js')}
passages = module_rows('passages.js')

def sha(text): return hashlib.sha1(text.encode('utf-8')).hexdigest()[:12]
def plain(text): return re.sub(r'<[^>]+>', '', text)

ARCHAIC = re.compile(r"\b(thee|thou|thy|thine|hath|doth|'tis|ye|shalt|wilt|o'er|nay|"
                     r"methinks|mine own|t'other|'em|an'|ain't|warn't|'ee)\b", re.I)
TRUNCATED = re.compile(r'\b(Mr|Mrs|Dr|St)\.\s*$')

def quotes_balance(text):
    """A double quote after a space or at the start opens, anywhere else it closes.
    An excerpt cut out of a conversation closes one it never opened."""
    open_ = False
    for m in re.finditer(r'"', text):
        before = text[m.start() - 1] if m.start() else ' '
        after = text[m.end():m.end() + 1]
        opening = before in ' (\n' or (before == '—' and after.isalnum())
        if opening == open_: return False
        open_ = opening
    return not open_

def mechanics(p):
    """Everything that can be measured without reading - returns (numbers, flags)."""
    text = plain(p['text'])
    sentences = [s for s in re.split(r'(?<=[.!?])["\'”’)]*\s+', text) if s.strip()]
    lengths = [len(s.split()) for s in sentences]
    n = len(text.split())
    flags = []
    if n < 25: flags.append(f'short ({n} words)')
    if n > 110: flags.append(f'long ({n} words)')
    if max(lengths) > 45: flags.append(f'a {max(lengths)}-word sentence')
    if re.search(r'(^|\W)_\w|\w_(\W|$)', text): flags.append('markup left in (_italics_)')
    if TRUNCATED.search(text): flags.append('cut off at a title')
    if not re.search(r'[.!?…]["\'”’)]*$', text.strip()): flags.append('no closing punctuation')
    if text[0].islower(): flags.append('starts mid-sentence')
    if not quotes_balance(text): flags.append('unbalanced quotation marks')
    if ARCHAIC.search(text): flags.append(f'old form "{ARCHAIC.search(text).group(0)}"')
    owner = words[p['w']]['word']
    if re.search(rf'<mark data-word="{re.escape(owner)}">[^<]*</mark>-\w|\w-<mark data-word="{re.escape(owner)}"', p['text']):
        flags.append('target inside a compound')
    if f'data-word="{owner}"' not in p['text']: flags.append('never marks its own word')
    return {'words': n, 'longest': max(lengths), 'mean': round(n / len(lengths), 1)}, flags

def verdict(p, j, flags):
    """Why this passage does not clear the bar, or None if it does."""
    if j is None: return 'not judged'
    if j['sha'] != sha(p['text']): return 'text changed since it was judged'
    s, c, r, a = j['s'], j['c'], j['r'], j['a']
    if flags: return '; '.join(flags)
    if s == 0: return 'wrong sense'
    if s == 1 and not p.get('sense'): return 'neighbouring sense with no `sense` label'
    if s == 2 and p.get('sense'): return 'judged the card sense but carries a `sense` label'
    if min(c, r, a) < 1: return 'a zero in ' + ''.join(k for k, v in zip('CRA', (c, r, a)) if v < 1)
    if c + r + a < 4: return f'C+R+A = {c + r + a}, below 4'
    return None

def main(argv):
    audit = {j['id']: j for j in json.loads(AUDIT.read_text())} if AUDIT.exists() else {}

    if '--stamp' in argv:
        for p in passages:
            if p['id'] in audit: audit[p['id']]['sha'] = sha(p['text'])
        AUDIT.write_text('[\n' + ',\n'.join(json.dumps(audit[k]) for k in sorted(audit)) + '\n]\n')
        print(f'stamped {len(audit)} judgements - only do this after re-reading what changed')
        return 0

    rows = []
    for p in passages:
        numbers, flags = mechanics(p)
        j = audit.get(p['id'])
        rows.append((p, j, numbers, flags, verdict(p, j, flags)))

    only = [a for a in argv if not a.startswith('-')]
    if only:
        target = [w for w in words.values() if w['word'] == only[0]]
        if not target: print(f'no word "{only[0]}"'); return 1
        w = target[0]
        print(f"{w['word']} ({w['pos']}): {w['definition']}\n")
        for p, j, numbers, flags, why in rows:
            if p['w'] != w['id']: continue
            score = f"S{j['s']} C{j['c']} R{j['r']} A{j['a']}" if j else 'unjudged'
            print(f"#{p['id']:<4} {score}  {'book' if p['source'] else 'written'}  "
                  f"{numbers['words']}w  {'FAIL: ' + why if why else 'ok'}")
            if p.get('sense'): print(f"       sense: {p['sense']}")
            print('      ', plain(p['text'])[:160], '\n')
        return 0

    failures = [(p, why) for p, j, _, _, why in rows if why]
    shelves = {}
    for p, j, *_ in rows:
        shelves.setdefault(p['w'], []).append(j['s'] if j else 0)
    thin = {w: s.count(2) for w, s in shelves.items() if s.count(2) < 7}

    judged = [j for _, j, *_ in rows if j]
    total = Counter(j['s'] + j['c'] + j['r'] + j['a'] for j in judged)
    book = sum(1 for p in passages if p['source'])
    print(f'{len(passages)} passages: {book} from books, {len(passages) - book} written for the course')
    print(f"in the card's sense: {sum(j['s'] == 2 for j in judged)}   "
          f"labelled neighbouring sense: {sum(j['s'] == 1 for j in judged)}   "
          f"wrong sense: {sum(j['s'] == 0 for j in judged)}")
    for key, name in (('c', 'context'), ('r', 'readable'), ('a', 'alone')):
        dist = Counter(j[key] for j in judged)
        print(f'{name:>9}: ' + '  '.join(f'{v}={dist.get(v, 0)}' for v in (2, 1, 0)))
    print('score /8: ' + '  '.join(f'{k}={total[k]}' for k in sorted(total, reverse=True)))
    longest = max(r[2]['longest'] for r in rows)
    print(f"words per passage {min(r[2]['words'] for r in rows)}-{max(r[2]['words'] for r in rows)}, "
          f'longest sentence {longest}')

    if failures:
        print(f'\n{len(failures)} passages below the bar:')
        for p, why in failures[:40]:
            print(f"  #{p['id']} {words[p['w']]['word']}: {why}")
    if thin:
        print(f'\n{len(thin)} shelves with fewer than 7 passages in the card\'s sense:')
        for w, n in thin.items(): print(f"  {words[w]['word']}: {n}")
    if failures or thin: return 1
    print('\nevery passage and every shelf clears the bar')
    return 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))

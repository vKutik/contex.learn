/* The deploy gate.
 *
 * Everything here answers one question: if this tree were pushed to Pages
 * right now, would it work? The two traps CLAUDE.md names cost real debugging
 * time once already and are the first two tests below. The rest catch the
 * class of breakage that only shows up once the site is live - a renamed
 * module, a stylesheet that 404s, a recording nobody committed - none of
 * which a browser on localhost with a warm cache will tell you about.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, abs, rel, read, exists, appFiles, codeOnly, importsOf, linesMatching } from '../helpers/paths.mjs';

const source = Object.fromEntries(appFiles().map(f => [rel(f), fs.readFileSync(f, 'utf8')]));
const code   = Object.fromEntries(Object.entries(source).map(([f, s]) => [f, codeOnly(s)]));

/* ---------- trap 1: Jekyll eats anything beginning with an underscore ---------- */

test('.nojekyll exists, or styles/_font.css 404s on the live site only', () => {
  assert.ok(exists('.nojekyll'),
    'without .nojekyll, GitHub Pages runs the repo through Jekyll and drops _font.css');
});

test('the underscore-named files that make .nojekyll necessary are still there', () => {
  const underscored = fs.readdirSync(abs('styles')).filter(f => f.startsWith('_'));
  assert.ok(underscored.length, 'no underscore files left - keep .nojekyll anyway, it is free');
});

/* ---------- trap 2: the build stamp ---------- */

test('js/build.js and version.txt carry the same build id', () => {
  const stamped = read('js','build.js').match(/BUILD\s*=\s*'([^']+)'/);
  assert.ok(stamped, 'js/build.js no longer declares BUILD');
  assert.equal(stamped[1], read('version.txt').trim(),
    'run `python3 tools_stamp.py` - while these disagree, fresh.js reloads every tab forever');
});

test('the build id looks like tools_stamp.py wrote it', () => {
  const id = read('version.txt').trim();
  assert.match(id, /^\d{8}-\d{4}(-[0-9a-f]{7,})?$/, `"${id}" is not a stamped build id`);
});

test('version.txt is a single line, because fresh.js compares it whole', () => {
  assert.equal(read('version.txt').trim().split('\n').length, 1);
});

/* ---------- everything the page asks the server for ---------- */

test('every file index.html references is in the repo', () => {
  const html = read('index.html');
  const refs = [...html.matchAll(/(?:href|src)="([^"?#]+)"/g)].map(m => m[1])
    .filter(u => !/^(https?:|data:|mailto:|#)/.test(u));
  assert.ok(refs.length >= 4, 'index.html suddenly references almost nothing');
  for(const ref of refs) assert.ok(exists(ref), `index.html asks for ${ref}, which is not in the repo`);
});

test('the app is loaded as a module, because it is written as one', () => {
  assert.match(read('index.html'), /<script type="module" src="js\/app\.js">/);
});

test('every import in every module resolves to a file that exists', () => {
  for(const [file, src] of Object.entries(source)){
    for(const spec of importsOf(src).filter(s => s.startsWith('.'))){
      const target = path.resolve(path.dirname(abs(file)), spec);
      assert.ok(fs.existsSync(target), `${file} imports ${spec}, which does not exist`);
    }
  }
});

test('every @import in the stylesheets resolves too - this is the one Jekyll broke', () => {
  for(const css of fs.readdirSync(abs('styles'))){
    const src = read('styles', css);
    for(const m of src.matchAll(/@import\s+(?:url\()?['"]([^'"]+)['"]/g)){
      assert.ok(fs.existsSync(abs('styles', m[1])), `styles/${css} imports ${m[1]}, which is missing`);
    }
  }
});

test('the audio folder holds one recording per word and no orphans', () => {
  const onDisk = new Set(fs.readdirSync(abs('audio')));
  const wanted = new Set(Object.values(
    JSON.parse(JSON.stringify(readPronunciationSources()))).map(s => path.basename(s)));
  for(const file of wanted) assert.ok(onDisk.has(file), `audio/${file} is referenced but not committed`);
  for(const file of onDisk) assert.ok(wanted.has(file), `audio/${file} is committed but nothing plays it`);
});

function readPronunciationSources(){
  const src = read('js','data','pronunciation.js');
  return [...src.matchAll(/"src":\s*"([^"]+)"/g)].map(m => m[1]);
}

/* ---------- rule 5: no dependencies, no build step, no framework ---------- */

test('the app has no package manifest and no installed dependencies', () => {
  assert.ok(!exists('package.json'), 'a package.json would mean a dependency or a build step');
  assert.ok(!exists('node_modules'));
});

test('no module loads code from a CDN or a bare package name', () => {
  for(const [file, src] of Object.entries(source)){
    for(const spec of importsOf(src)){
      assert.ok(spec.startsWith('.'), `${file} imports "${spec}" - the app ships without dependencies`);
    }
  }
  assert.doesNotMatch(read('index.html'), /<script[^>]+src="https?:/,
    'index.html pulls in a script from the network');
});

test('every import specifier keeps its .js extension, which the browser requires', () => {
  for(const [file, src] of Object.entries(source)){
    for(const spec of importsOf(src)){
      assert.match(spec, /\.js$/, `${file} imports ${spec} without an extension`);
    }
  }
});

/* ---------- rule 1: one way to save ---------- */

test('only storage.js and settings.js touch web storage', () => {
  const allowed = new Set(['js/storage.js', 'js/settings.js', 'js/fresh.js']);
  for(const [file, src] of Object.entries(code)){
    if(allowed.has(file)) continue;
    assert.deepEqual(linesMatching(src, /\b(localStorage|sessionStorage|indexedDB)\b/), [],
      `${file} persists something itself - only storage.js may`);
  }
});

test('only storage.js knows the progress key', () => {
  for(const [file, src] of Object.entries(source)){
    if(file === 'js/storage.js') continue;
    assert.doesNotMatch(src, /vocab-progress/, `${file} names the progress key`);
  }
});

test('fresh.js only uses sessionStorage, and only for the reload guard', () => {
  const src = code['js/fresh.js'];
  assert.doesNotMatch(src, /\blocalStorage\b/, 'fresh.js must not touch saved progress');
  assert.match(src, /sessionStorage/);
});

test('only storage.js knows where the usage log is kept', () => {
  for(const [file, src] of Object.entries(source)){
    if(file === 'js/storage.js') continue;
    assert.doesNotMatch(src, /vocab-events/, `${file} names the usage-log key`);
  }
});

/* The usage log promises it never leaves the device unless exported. The one
   request the app makes is fresh.js asking for version.txt; anything else
   that can reach a network is a promise broken. */
test('the app sends nothing anywhere - the only request is the build check', () => {
  for(const [file, src] of Object.entries(code)){
    const net = linesMatching(src, /\b(fetch|sendBeacon|XMLHttpRequest|WebSocket|EventSource)\b/);
    if(file === 'js/fresh.js') assert.equal(net.length, 1, 'fresh.js fetches version.txt and nothing else');
    else assert.deepEqual(net, [], `${file} can reach the network`);
  }
});

/* ---------- rule 2: srs.js has no DOM ---------- */

test('the scheduling rules could move to a server untouched', () => {
  for(const file of ['js/srs.js', 'js/session.js', 'js/util.js', 'js/data.js']){
    assert.deepEqual(
      linesMatching(code[file], /\b(document|window|navigator|localStorage|alert|HTMLElement)\b/), [],
      `${file} reaches for the browser - it is meant to be portable logic`);
  }
});

/* ---------- rule 3 and 4: JSON-first, and one home per helper ---------- */

test('no sentence, definition or question is written into the markup', () => {
  const body = read('index.html').split('<body>')[1] || '';
  assert.match(body, /<main id="screen"[^>]*><\/main>/,
    'index.html is markup only: every screen is rendered by app.js');
});

test('only word.js reads the {braces} convention', () => {
  for(const [file, src] of Object.entries(code)){
    if(file === 'js/components/word.js') continue;
    assert.deepEqual(linesMatching(src, /\\\{\(\.\+\?\)\\\}|\{\(\.\+\?\)\}/), [],
      `${file} parses the braces marker itself - word.js owns that`);
  }
});

test('every export is imported by something, bar the three documented seams', () => {
  const seams = new Set(['js/data.js:fetchWords','js/data.js:fetchLessons','js/data.js:fetchPassages']);
  const unused = [];
  for(const [file, src] of Object.entries(code)){
    const names = new Set();
    for(const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/g))
      names.add(m[1]);
    for(const m of src.matchAll(/export\s*\{([^}]+)\}/g))
      m[1].split(',').forEach(part => { const n = part.trim().split(/\s+as\s+/).pop().trim(); if(n) names.add(n); });

    const elsewhere = Object.entries(code).filter(([f]) => f !== file).map(([, s]) => s).join('\n');
    for(const name of names){
      if(seams.has(`${file}:${name}`)) continue;
      if(!new RegExp(`\\b${name.replace(/\$/g,'\\$')}\\b`).test(elsewhere)) unused.push(`${file}:${name}`);
    }
  }
  assert.deepEqual(unused, [], 'dead exports: either something should use them, or they should go');
});

test('nothing debug-shaped is going out with the build', () => {
  for(const [file, src] of Object.entries(code)){
    assert.deepEqual(linesMatching(src, /\bdebugger\b|\bconsole\.(log|warn|error|debug)\b/), [],
      `${file} still has debug output in it`);
  }
});

/* ---------- the tests themselves must not become part of the app ---------- */

test('nothing the browser loads knows that tests/ exists', () => {
  assert.doesNotMatch(read('index.html'), /tests\//);
  for(const [file, src] of Object.entries(source)){
    assert.doesNotMatch(src, /['"][^'"]*tests\//, `${file} references the test folder`);
  }
});

test('the test suite adds no file to the shipped surface', () => {
  const shipped = fs.readdirSync(ROOT).filter(f => !f.startsWith('.') && f !== 'tests');
  for(const entry of shipped){
    assert.ok(!fs.existsSync(path.join(ROOT, entry, '.test.mjs')));
  }
  assert.ok(exists('tests'), 'the suite lives in tests/ and nowhere else');
});

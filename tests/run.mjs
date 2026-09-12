#!/usr/bin/env node
/* run.mjs - the deploy gate. One command, one exit code.
 *
 *   node tests/run.mjs              everything
 *   node tests/run.mjs unit         one suite (unit | data | deploy | e2e)
 *   node tests/run.mjs --no-browser skip the browser suites
 *
 * Run it before every deploy. The suites are ordered cheapest first, so a
 * broken data file or a missing build stamp fails in under a second rather
 * than after Chromium has started.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserSkip } from './helpers/browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUITES = ['unit', 'data', 'deploy', 'e2e'];

/* The app's modules are ES modules in .js files with no package.json to say
   so, which Node works out for itself only from 22 onwards. Say that plainly
   rather than letting it surface as a syntax error inside storage.js. */
const [major] = process.versions.node.split('.').map(Number);
if(major < 22){
  console.error(`Node ${process.versions.node} is too old for these tests - 22 or newer, please.`);
  console.error('(The app itself has no such requirement: it runs in any browser with ES modules.)');
  process.exit(1);
}

const args = process.argv.slice(2);
const noBrowser = args.includes('--no-browser');
const wanted = args.filter(a => !a.startsWith('-'));
const bad = wanted.filter(a => !SUITES.includes(a));
if(bad.length){
  console.error(`unknown suite: ${bad.join(', ')} - pick from ${SUITES.join(', ')}`);
  process.exit(1);
}

const chosen = (wanted.length ? wanted : SUITES).filter(s => !(noBrowser && s === 'e2e'));

const filesIn = suite => {
  const dir = path.join(HERE, suite);
  if(!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.test.mjs')).sort()
    .map(f => path.join(dir, f));
};

const files = chosen.flatMap(filesIn);
if(!files.length){ console.error('no test files found'); process.exit(1); }

console.log(`ContextLearn — ${files.length} test files across ${chosen.join(', ')}\n`);

/* A browser suite that quietly skips is worse than one that fails: the run
   still says green and the deploy goes out unchecked. Say it twice, loudly. */
const blind = chosen.includes('e2e') && browserSkip;
const warn = () => console.log(
  `\n  !! the browser suites did not run: ${browserSkip}\n` +
  `     nothing below has actually opened a page - do not treat this as a full pass.\n`);
if(blind) warn();
if(noBrowser) console.log('  (browser suites skipped by --no-browser)\n');

// the browser suites drive a real Chromium, which is slower than the default
const child = spawn(process.execPath,
  ['--test', '--test-reporter=spec', '--test-timeout=300000', ...files],
  { stdio: 'inherit', cwd: path.join(HERE, '..') });

child.on('exit', code => {
  if(code !== 0){ console.log('\nSomething is red - do not deploy.'); process.exit(code ?? 1); }
  if(blind){ warn(); process.exit(1); }
  console.log(noBrowser
    ? '\nGreen, but only the suites that do not need a browser. Run without --no-browser before deploying.'
    : '\nAll green. Remember `python3 tools_stamp.py` before committing a change to the app.');
  process.exit(0);
});

/* progress.js - the gauge and the familiarity dots.
 *
 * Pure rendering, so it is checked as arithmetic and markup. The percentage
 * matters more than it looks: it is the first thing on the home screen and it
 * used to disagree with the arc drawn underneath it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progressRing, familiarityDots } from '../../js/components/progress.js';

const pctOf = html => +html.match(/class="gnum"[^>]*>(\d+)</)[1];
const counts = over => ({ known:0, read:0, started:0, total:100, today:null, ...over });

test('a fresh install reads 0%', () => {
  assert.equal(pctOf(progressRing(counts())), 0);
});

test('the whole journey counts: a third for opening, two thirds for proving, all at box 4', () => {
  assert.equal(pctOf(progressRing(counts({ started:3 }))), 1);      // 1.0 of 100
  assert.equal(pctOf(progressRing(counts({ read:3 }))), 2);         // 2.0
  assert.equal(pctOf(progressRing(counts({ known:3 }))), 3);        // 3.0
  assert.equal(pctOf(progressRing(counts({ known:100 }))), 100);
});

test('real work never rounds away to nothing', () => {
  // one word opened is a third of one percent - the complaint that started this
  assert.equal(pctOf(progressRing(counts({ started:1 }))), 1);
});

test('the arc and the number are the same sum, so they cannot disagree', () => {
  const html = progressRing(counts({ known:10, read:10, started:10 }));
  const lengths = [...html.matchAll(/stroke-dasharray="([\d.]+) /g)].map(m => +m[1]);
  const [track, red, amber, green] = lengths;
  assert.ok(green < amber && amber < red && red < track,
    'the three coloured segments stack inside the track');
  const ARC = track;
  assert.ok(Math.abs(green - ARC * 10 / 100) < 0.01, 'green is the known weight');
  assert.ok(Math.abs(amber - green - ARC * 10 * (2/3) / 100) < 0.01, 'amber adds the read weight');
  assert.ok(Math.abs(red - amber - ARC * 10 * (1/3) / 100) < 0.01, 'red adds the started weight');
  assert.equal(pctOf(html), 20);
});

test('the gauge says what it is for a screen reader', () => {
  assert.match(progressRing(counts({ started:6 })), /aria-label="2% of the way through 100 words"/);
});

test('the legend prints all three counts', () => {
  const html = progressRing(counts({ known:1, read:2, started:3 }));
  assert.match(html, /Learned <b>1<\/b>/);
  assert.match(html, /Seen <b>2<\/b>/);
  assert.match(html, /Started <b>3<\/b>/);
});

test('the day tally counts both right and wrong, and knows about the singular', () => {
  assert.match(progressRing(counts({ today:{ right:1, wrong:0 } })), /1 answer today · <b>1<\/b> right/);
  assert.match(progressRing(counts({ today:{ right:3, wrong:2 } })), /5 answers today · <b>3<\/b> right/);
});

test('the tally and the daily budget are one line, not the same number twice', () => {
  const html = progressRing(counts({ today:{ right:3, wrong:2 }, budget:80 }));
  assert.equal((html.match(/class="today"/g) || []).length, 1);
  assert.match(html, /5 of 80 answers today · <b>3<\/b> right/);
  // before any work the budget still says how much room the day has, but
  // there is no "0 right" to report
  const idle = progressRing(counts({ today:{ right:0, wrong:0 }, budget:80 }));
  assert.match(idle, /0 of 80 answers today<\/div>/);
  assert.doesNotMatch(idle, /right/);
});

/* ---------- the familiarity dots ---------- */

const lit = html => (html.match(/<i class="on/g) || []).length;

test('the dots count the steps taken', () => {
  assert.equal(lit(familiarityDots({ level:0, cooling:false })), 0);
  assert.equal(lit(familiarityDots({ level:1, cooling:false })), 1);
  assert.equal(lit(familiarityDots({ level:2, cooling:false })), 2);
  assert.equal(lit(familiarityDots({ level:3, cooling:false })), 3);
});

test('three dots close into a line', () => {
  assert.match(familiarityDots({ level:3, cooling:false }), /class="fam full"/);
  assert.doesNotMatch(familiarityDots({ level:2, cooling:false }), /full/);
});

test('only the last lit dot cools', () => {
  const html = familiarityDots({ level:2, cooling:true });
  assert.equal((html.match(/cool/g) || []).length, 1);
  assert.match(html, /<i class="on"><\/i><i class="on cool"><\/i>/);
});

test('each level names itself for a screen reader', () => {
  const titles = ['not met in a text yet','read in a text','answered from the text','mastered'];
  titles.forEach((title, level) =>
    assert.match(familiarityDots({ level, cooling:false }), new RegExp(`aria-label="${title}"`)));
});

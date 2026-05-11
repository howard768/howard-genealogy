#!/usr/bin/env node
// Offline regression suite. Loads fixture JSONs that simulate Find a Grave
// search results and asserts the matcher picks the correct memorial id.
// No network. Run with: npm test  or  node tests/run.js

const fs = require('fs');
const path = require('path');
const { pickBest, cleanCandidateName } = require('../match');
const { extractYear, normalizePlace } = require('../lib/gedcom');
const { equivalent } = require('../lib/nicknames');
const { levenshtein, normalizeForCompare } = require('../lib/strings');

const FIXTURES = path.join(__dirname, 'fixtures');
let pass = 0;
let fail = 0;

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
}

function assertEq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
    console.log(`  ok  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}`);
    console.log(`       expected: ${JSON.stringify(expected)}`);
    console.log(`       actual:   ${JSON.stringify(actual)}`);
  }
}

console.log('\nlib/strings');
assertEq('normalizeForCompare diacritics', normalizeForCompare('François'), 'francois');
assertEq('levenshtein equal', levenshtein('Wilson', 'Wilson'), 0);
assertEq('levenshtein 1 sub', levenshtein('Wilson', 'Wilsen'), 1);

console.log('\nlib/nicknames');
assertEq('John ↔ Jack', equivalent('John', 'Jack'), true);
assertEq('Mary ↔ Polly', equivalent('Mary', 'Polly'), true);
assertEq('Hugh ≠ Henry', equivalent('Hugh', 'Henry'), false);

console.log('\nlib/gedcom date parsing');
assertEq('extractYear plain', extractYear('1856'), 1856);
assertEq('extractYear ABT', extractYear('ABT 1838'), 1838);
assertEq('extractYear BEF', extractYear('BEF 1900'), 1900);
assertEq('extractYear full', extractYear('19 AUG 1856'), 1856);
assertEq('extractYear BET midpoint', extractYear('BET 1830 AND 1840'), 1835);
assertEq('extractYear null', extractYear(null), null);

console.log('\nlib/gedcom place parsing');
const p1 = normalizePlace('Brooklyn, Kings, New York, USA');
assertEq('place city', p1.city, 'Brooklyn');
assertEq('place region', p1.region, 'New York');
assertEq('place country', p1.country, 'USA');
const p2 = normalizePlace('Glasgow, Scotland');
assertEq('place region direct', p2.region, 'Scotland');
assertEq('place country direct', p2.country, 'UK');

console.log('\nmatch.js — cleanCandidateName (FAG search blob bug)');
assertEq('strip year suffix', cleanCandidateName('Fred C Howard 1922-1984'), 'Fred C Howard');
assertEq('strip month+year', cleanCandidateName('David French Smith Apr 1848-1915'), 'David French Smith');
assertEq('strip trailing place after comma', cleanCandidateName('Hugh Wilson, Brooklyn, NY'), 'Hugh Wilson');
assertEq('keep May as name when no digit follows', cleanCandidateName('Mary May Smith'), 'Mary May Smith');
assertEq('plain name unchanged', cleanCandidateName('Mary Elizabeth Wilson'), 'Mary Elizabeth Wilson');

console.log('\nsearch.js — year extraction (full-date header bug)');
{
  // Mirrors the regex used inside search.js page.evaluate. Asserting the
  // pattern here so future edits to either side stay in sync.
  function extractYears(cardText) {
    const all = (cardText.match(/\b\d{4}\b/g) || [])
      .map((y) => parseInt(y, 10))
      .filter((y) => y >= 1500 && y <= 2100);
    if (all.length >= 2 && all[0] <= all[1]) return [all[0], all[1]];
    return [null, null];
  }
  assertEq(
    'Compston full-date header',
    extractYears('Harold William "Bill" Compston Veteran 8 Jan 1930 – 18 Sep 2000'),
    [1930, 2000]
  );
  assertEq(
    'plain year-dash-year',
    extractYears('Hugh Wilson 1856-1906 The Evergreens Cemetery'),
    [1856, 1906]
  );
  assertEq(
    'en-dash spaced',
    extractYears('Hugh M. Wilson 1857 – 1906 Brooklyn'),
    [1857, 1906]
  );
  assertEq(
    'ignores trailing photo-added year',
    extractYears('Mary Greene 1858 – 1935 Photo added 2024'),
    [1858, 1935]
  );
  assertEq(
    'single year only — no guess',
    extractYears('John Smith born 1900, still living'),
    [null, null]
  );
}

console.log('\nmatch.js — Hugh Wilson regression');
{
  const ind = load('hugh-wilson.json');
  const cands = load('wilson-candidates.json');
  const decision = pickBest(ind, cands);
  assertEq('Hugh Wilson resolved', decision.status, 'resolved');
  assertEq('Hugh Wilson memorial id', decision.memorialId, '194480890');
}

console.log('\nmatch.js — Hugh Wilson regression with blobby FAG names');
{
  const ind = load('hugh-wilson.json');
  const cands = load('wilson-candidates-blobby.json');
  const decision = pickBest(ind, cands);
  assertEq('Hugh Wilson resolved despite blob', decision.status, 'resolved');
  assertEq('Hugh Wilson memorial id from blob', decision.memorialId, '194480890');
}

console.log('\nmatch.js — Mary Elizabeth Greene Wilson (maiden surnameAlt)');
{
  const ind = load('mary-elizabeth-greene-wilson.json');
  const cands = load('mary-greene-candidates.json');
  const decision = pickBest(ind, cands);
  assertEq('Mary Greene resolved via surnameAlt', decision.status, 'resolved');
  assertEq('Mary Greene memorial id', decision.memorialId, '194481027');
}

console.log('\nmatch.js — Mary J. Pilkington (initial collapse + maiden)');
{
  const ind = load('mary-pilkington.json');
  const cands = load('mary-pilkington-candidates.json');
  const decision = pickBest(ind, cands);
  assertEq('Mary J. Pilkington resolved', decision.status, 'resolved');
  assertEq('Mary J. Pilkington memorial id', decision.memorialId, '195054679');
}

console.log('\nmatch.js — empty candidates');
{
  const ind = load('hugh-wilson.json');
  const decision = pickBest(ind, []);
  assertEq('empty → no_match', decision.status, 'no_match');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

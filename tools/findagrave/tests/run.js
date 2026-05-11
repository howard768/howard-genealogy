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
assertEq(
  'strip Veteran badge with day-number date',
  cleanCandidateName('Harold William "Bill" Compston VVeteran 8 Jan 1930 – 18 Sep 2000'),
  'Harold William "Bill" Compston'
);
assertEq(
  'strip concatenated Veteran badge',
  cleanCandidateName('Fred C HowardVeteran 1922-1984'),
  'Fred C Howard'
);
assertEq(
  'strip Famous badge',
  cleanCandidateName('Babe Ruth Famous 1895 – 1948'),
  'Babe Ruth'
);
assertEq(
  'pure single-digit day number stops parser',
  cleanCandidateName('John Smith 8 Jan 1900'),
  'John Smith'
);
assertEq(
  'strip Flowers-have-been-left metadata',
  cleanCandidateName('Fred C Howard Flowers have been left 1922-1984'),
  'Fred C Howard'
);
assertEq(
  'strip No-grave-photo metadata',
  cleanCandidateName('Coral M Russell No grave photo 1898-1976'),
  'Coral M Russell'
);
assertEq(
  'strip Add-a-photo metadata',
  cleanCandidateName('Some Person Add a photo 1900-1990'),
  'Some Person'
);

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

console.log('\nmatch.js — Coral May Russell (metadata at start of name)');
{
  const ind = load('coral-russell.json');
  // Use a candidate where "No grave photo" appears BEFORE the name —
  // mirrors the actual FAG card text the Mac re-rescore exposed.
  const cands = [
    {
      id: '239406509',
      name: 'No grave photo C M. Russell Flowers have been left. • No grave photo 9 May 1898 – 29 Nov 1976',
      birthYear: 1898,
      deathYear: 1976,
      cemetery: null,
      cemeteryLocation: 'Tarpon Springs, Pinellas, Florida, USA',
      snippetText: 'C M. Russell Tarpon Springs Florida',
    },
    {
      id: '74905861',
      name: 'C Jack Russell 1900 – 1976',
      birthYear: 1900,
      deathYear: 1976,
      cemetery: 'Cycadia Cemetery',
      cemeteryLocation: 'Tarpon Springs, Pinellas, Florida, USA',
      snippetText: 'C Jack Russell 1900 1976 Cycadia Cemetery Tarpon Springs',
    },
  ];
  const decision = pickBest(ind, cands);
  assertEq('Coral top candidate is C M. Russell', decision.candidates[0].id, '239406509');
}

console.log('\nmatch.js — Fred Charles Howard (perfect-signal bypass)');
{
  const ind = load('fred-howard.json');
  const cands = load('fred-howard-candidates.json');
  const decision = pickBest(ind, cands);
  // Top scores 95 (every signal maxed); runner-up at 87. Common-surname
  // penalty would otherwise keep him ambiguous. The perfect-signal
  // bypass must auto-resolve to 254069216. "Fred Charles" vs "Fred C"
  // is initial-collapse compatible.
  assertEq('Fred resolved by perfect-signal bypass', decision.status, 'resolved');
  assertEq('Fred memorial id', decision.memorialId, '254069216');
}

console.log('\nmatch.js — Stephanie Rendon (living person vs deceased namesake)');
{
  // Born 1988, no death in GEDCOM. The only candidate has a death year of
  // 1996 (a deceased 8-year-old). Without the living-mismatch gate, this
  // resolved because death-missing scored as neutral. With the gate, it
  // must stay ambiguous (or no_match) so a human catches it.
  const ind = load('stephanie-rendon.json');
  const cands = [
    {
      id: '244995686',
      name: 'Stephanie Rendon 23 Dec 1987 – 12 Dec 1996',
      birthYear: 1987,
      deathYear: 1996,
      cemetery: null,
      cemeteryLocation: 'Miami, Miami-Dade, Florida, USA',
      snippetText: 'Stephanie Rendon 1987 1996 Miami Florida',
    },
  ];
  const decision = pickBest(ind, cands);
  // The candidate is still surfaced (ambiguous), but the resolve gate
  // must block it from being committed.
  assertEq('Stephanie does not auto-resolve', decision.status === 'resolved', false);
}

console.log('\nmatch.js — William Melvin vs William H (middle-name false positive)');
{
  // Without the middle-name guard, this candidate would bypass-resolve:
  // William=William, Howard=Howard, birth ±0, death ±0 → "perfect."
  // But Melvin ≠ H — must stay ambiguous.
  const ind = load('william-melvin-howard.json');
  const cands = load('william-h-candidates.json');
  const decision = pickBest(ind, cands);
  assertEq('William Melvin stays ambiguous', decision.status, 'ambiguous');
}

console.log('\nmatch.js — Mary Elizabeth vs Mary Emma (middle-name false positive)');
{
  // Mary Elizabeth Greene vs "Mary Emma Greene": exact first token,
  // exact surname, exact dates, but Elizabeth ≠ Emma.
  const ind = load('mary-elizabeth-greene-wilson.json');
  const cands = [
    {
      id: '105183120',
      name: 'Mary Emma Greene 15 Apr 1858 – 2 Jan 1933',
      birthYear: 1858,
      deathYear: 1933,
      cemetery: null,
      cemeteryLocation: 'Brooklyn, Kings County, New York, USA',
      snippetText: 'Mary Emma Greene 1858 1933 Brooklyn New York',
    },
  ];
  const decision = pickBest(ind, cands);
  assertEq('Mary Elizabeth ≠ Mary Emma stays ambiguous', decision.status, 'ambiguous');
}

console.log('\nmatch.js — Bill Compston end-to-end (badge + day-number bug)');
{
  const ind = load('bill-compston.json');
  const cands = load('bill-compston-candidates.json');
  const decision = pickBest(ind, cands);
  assertEq('Bill Compston resolved', decision.status, 'resolved');
  assertEq('Bill Compston memorial id', decision.memorialId, '54782399');
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

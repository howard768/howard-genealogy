#!/usr/bin/env node
// Pure scoring + decision logic. No I/O, no network. Importable from sweep.js;
// runnable as a CLI for offline debugging:
//
//   node match.js <individual.json> <candidates.json>
//
// Returns { status: 'resolved'|'ambiguous'|'no_match', memorialId?, candidates }.

const fs = require('fs');
const { normalizeForCompare, levenshtein, givenTokens, givenInitials } = require('./lib/strings');
const { equivalent } = require('./lib/nicknames');

const COMMON_SURNAMES = new Set([
  'smith', 'wilson', 'greene', 'green', 'brown', 'jones', 'miller', 'murphy',
  'johnson', 'williams', 'davis', 'taylor',
]);

// ---- Scoring components ----------------------------------------------------

function scoreSurname(individual, candidate) {
  const cand = normalizeForCompare(extractCandidateSurname(candidate.name));
  const primary = normalizeForCompare(individual.surname);
  if (cand && primary && cand === primary) return { points: 30, reason: 'surname:exact' };
  for (const alt of individual.surnameAlt || []) {
    const a = normalizeForCompare(alt);
    if (a && a === cand) return { points: 30, reason: 'surname:alt-exact' };
  }
  if (cand && primary && primary.length >= 6 && levenshtein(primary, cand) <= 2) {
    return { points: 22, reason: 'surname:lev<=2' };
  }
  return { points: 0, reason: null };
}

function extractCandidateSurname(fullName) {
  const cleaned = cleanCandidateName(fullName);
  if (!cleaned) return '';
  const tokens = cleaned.trim().split(/\s+/);
  return tokens[tokens.length - 1] || '';
}

function extractCandidateGiven(fullName) {
  const cleaned = cleanCandidateName(fullName);
  if (!cleaned) return '';
  const tokens = cleaned.trim().split(/\s+/);
  return tokens.slice(0, -1).join(' ');
}

// Trim trailing date/place text off a candidate's name string. FAG search
// cards bundle "Fred C Howard 1922-1984 Pinellas County..." into one text
// blob, and a naive split-on-whitespace gives "County" as the surname.
// Stop at the first token that's a year, a month-then-digit pair, or ends
// in a comma (place fragments).
const MONTH_RE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\.?$/i;
function cleanCandidateName(fullName) {
  if (!fullName) return '';
  const tokens = String(fullName).split(/\s+/).filter(Boolean);
  const kept = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^\d{3,4}/.test(t)) break;
    if (MONTH_RE.test(t) && i + 1 < tokens.length && /^\d/.test(tokens[i + 1])) break;
    if (t.endsWith(',')) {
      kept.push(t.slice(0, -1));
      break;
    }
    kept.push(t);
  }
  return kept.join(' ').trim();
}

function scoreGiven(individual, candidate) {
  const candGiven = extractCandidateGiven(candidate.name);
  const indGivenNorm = normalizeForCompare(individual.given);
  const candGivenNorm = normalizeForCompare(candGiven);
  if (!indGivenNorm || !candGivenNorm) return { points: 0, reason: null };

  const indFirst = givenTokens(indGivenNorm)[0] || '';
  const candFirst = givenTokens(candGivenNorm)[0] || '';

  if (indFirst && candFirst && indFirst === candFirst) {
    return { points: 25, reason: 'given:exact' };
  }
  if (indFirst && candFirst && equivalent(indFirst, candFirst)) {
    return { points: 22, reason: 'given:nickname' };
  }
  // Initial-collapse: "Mary J." ↔ "Mary Jane" — first tokens equal & one side
  // has an initial-only second token.
  if (indFirst && candFirst && indFirst === candFirst) {
    // Already handled above; but check initials more broadly.
  }
  const indInitials = givenInitials(individual.given);
  const candInitials = givenInitials(candGiven);
  if (
    indInitials &&
    candInitials &&
    (indInitials.startsWith(candInitials) || candInitials.startsWith(indInitials)) &&
    indFirst &&
    candFirst &&
    indFirst === candFirst
  ) {
    return { points: 20, reason: 'given:initial-collapse' };
  }
  if (indFirst && candFirst && indFirst.length >= 4 && levenshtein(indFirst, candFirst) <= 2) {
    return { points: 18, reason: 'given:lev<=2' };
  }
  return { points: 0, reason: null };
}

function scoreYear(indYear, candYear, label) {
  if (indYear == null || candYear == null) {
    return { points: 8, reason: `${label}:missing`, hardFail: false };
  }
  const drift = Math.abs(indYear - candYear);
  if (drift === 0) return { points: 20, reason: `${label}:+0`, hardFail: false };
  if (drift === 1) return { points: 17, reason: `${label}:±1`, hardFail: false };
  if (drift === 2) return { points: 12, reason: `${label}:±2`, hardFail: false };
  return { points: 0, reason: `${label}:drift>${drift}`, hardFail: true };
}

function scorePlace(individual, candidate) {
  const indPlaces = [individual.birth && individual.birth.place, individual.death && individual.death.place].filter(Boolean);
  if (!indPlaces.length) return { points: 0, reason: null };
  const candText = normalizeForCompare(
    [candidate.birthPlace, candidate.deathPlace, candidate.cemeteryLocation].filter(Boolean).join(' ')
  );
  if (!candText) return { points: 0, reason: null };
  let regionMatch = false;
  let cityMatch = false;
  for (const p of indPlaces) {
    if (p.region && candText.includes(normalizeForCompare(p.region))) regionMatch = true;
    if (p.country && candText.includes(normalizeForCompare(p.country))) regionMatch = regionMatch || true;
    if (p.city && candText.includes(normalizeForCompare(p.city))) cityMatch = true;
  }
  if (cityMatch) return { points: 5, reason: 'place:city' };
  if (regionMatch) return { points: 4, reason: 'place:region' };
  return { points: 0, reason: null };
}

function scoreCandidate(individual, candidate) {
  const surname = scoreSurname(individual, candidate);
  const given = scoreGiven(individual, candidate);
  const birth = scoreYear(
    individual.birth && individual.birth.year,
    candidate.birthYear,
    'birth'
  );
  const death = scoreYear(
    individual.death && individual.death.year,
    candidate.deathYear,
    'death'
  );
  const place = scorePlace(individual, candidate);

  const hardFail =
    (birth.hardFail && individual.birth && individual.birth.year != null) ||
    (death.hardFail && individual.death && individual.death.year != null);

  const reasons = [surname.reason, given.reason, birth.reason, death.reason, place.reason].filter(Boolean);
  const score = surname.points + given.points + birth.points + death.points + place.points;

  return {
    score,
    hardFail,
    reasons,
    components: {
      surname: surname.points,
      given: given.points,
      birth: birth.points,
      death: death.points,
      place: place.points,
    },
  };
}

// ---- Decision --------------------------------------------------------------

function pickBest(individual, candidates) {
  if (!candidates || candidates.length === 0) {
    return { status: 'no_match', candidates: [] };
  }
  const scored = candidates
    .map((c) => ({ candidate: c, ...scoreCandidate(individual, c) }))
    .filter((s) => !s.hardFail)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return { status: 'no_match', candidates: [] };

  const top = scored[0];
  const second = scored[1] || { score: 0 };
  const gap = top.score - second.score;

  const surnameLower = (individual.surname || '').toLowerCase();
  const isCommonSurname = COMMON_SURNAMES.has(surnameLower);
  const hasNoYears = (individual.birth.year == null) && (individual.death.year == null);
  const fullSurname = top.components.surname === 30;

  const indBirthYear = individual.birth && individual.birth.year;
  const indDeathYear = individual.death && individual.death.year;
  const birthClose =
    indBirthYear != null && top.components.birth >= 12; // ±2 or better
  const deathClose =
    indDeathYear != null && top.components.death >= 12;
  const eitherYearClose = birthClose || deathClose;
  const bothYearsClose = birthClose && deathClose;

  let resolved = false;
  if (hasNoYears) {
    resolved = top.score >= 90 && fullSurname && gap >= 20;
  } else if (isCommonSurname) {
    resolved = top.score >= 80 && gap >= 25 && fullSurname && bothYearsClose;
  } else {
    resolved = top.score >= 80 && gap >= 20 && fullSurname && eitherYearClose;
  }

  if (resolved) {
    return {
      status: 'resolved',
      memorialId: String(top.candidate.id),
      score: top.score,
      gap,
      reasons: top.reasons,
      candidates: scored.slice(0, 5).map(serialize),
    };
  }
  if (top.score >= 55) {
    return {
      status: 'ambiguous',
      score: top.score,
      gap,
      reasons: top.reasons,
      candidates: scored.slice(0, 5).map(serialize),
    };
  }
  return { status: 'no_match', score: top.score, candidates: scored.slice(0, 5).map(serialize) };
}

function serialize(scored) {
  return {
    id: String(scored.candidate.id),
    name: scored.candidate.name,
    birthYear: scored.candidate.birthYear || null,
    deathYear: scored.candidate.deathYear || null,
    cemetery: scored.candidate.cemetery || null,
    cemeteryLocation: scored.candidate.cemeteryLocation || null,
    score: scored.score,
    reasons: scored.reasons,
  };
}

// ---- CLI -------------------------------------------------------------------

if (require.main === module) {
  const [, , indPath, candsPath] = process.argv;
  if (!indPath || !candsPath) {
    console.error('Usage: node match.js <individual.json> <candidates.json>');
    process.exit(2);
  }
  const individual = JSON.parse(fs.readFileSync(indPath, 'utf8'));
  const candidates = JSON.parse(fs.readFileSync(candsPath, 'utf8'));
  console.log(JSON.stringify(pickBest(individual, candidates), null, 2));
}

module.exports = { scoreCandidate, pickBest, cleanCandidateName };

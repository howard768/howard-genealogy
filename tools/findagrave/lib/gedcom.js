// Wrapper over read-gedcom that produces the flat `Individual` records the
// matcher and sweep driver consume. Tolerant of incomplete data — every field
// can be null. The matcher penalizes missing data softly (no hard failure).

const fs = require('fs');
const { readGedcom } = require('read-gedcom');

// --- Date helpers -----------------------------------------------------------

function extractYear(dateRaw) {
  if (!dateRaw) return null;
  const s = String(dateRaw).toUpperCase().trim();
  // BET 1830 AND 1840 — midpoint
  const between = s.match(/^BET\s+(\d{3,4})\s+AND\s+(\d{3,4})/);
  if (between) return Math.round((parseInt(between[1], 10) + parseInt(between[2], 10)) / 2);
  // ABT / BEF / AFT / EST / CAL <year>
  const prefixed = s.match(/^(?:ABT|BEF|AFT|EST|CAL|FROM|TO)\s+.*?(\d{3,4})/);
  if (prefixed) return parseInt(prefixed[1], 10);
  // First 3-4 digit year anywhere
  const any = s.match(/\b(\d{3,4})\b/);
  return any ? parseInt(any[1], 10) : null;
}

// --- Place helpers ----------------------------------------------------------

const REGION_LOOKUP = {
  // US states
  'new york': { region: 'New York', country: 'USA' },
  'ny': { region: 'New York', country: 'USA' },
  'massachusetts': { region: 'Massachusetts', country: 'USA' },
  'ma': { region: 'Massachusetts', country: 'USA' },
  'connecticut': { region: 'Connecticut', country: 'USA' },
  'ct': { region: 'Connecticut', country: 'USA' },
  'ohio': { region: 'Ohio', country: 'USA' },
  'oh': { region: 'Ohio', country: 'USA' },
  'florida': { region: 'Florida', country: 'USA' },
  'fl': { region: 'Florida', country: 'USA' },
  'usa': { region: null, country: 'USA' },
  'united states': { region: null, country: 'USA' },
  'united states of america': { region: null, country: 'USA' },
  // Canada
  'quebec': { region: 'Quebec', country: 'Canada' },
  'qc': { region: 'Quebec', country: 'Canada' },
  'ontario': { region: 'Ontario', country: 'Canada' },
  'on': { region: 'Ontario', country: 'Canada' },
  'canada': { region: null, country: 'Canada' },
  // UK / Ireland
  'scotland': { region: 'Scotland', country: 'UK' },
  'england': { region: 'England', country: 'UK' },
  'wales': { region: 'Wales', country: 'UK' },
  'northern ireland': { region: 'Northern Ireland', country: 'UK' },
  'uk': { region: null, country: 'UK' },
  'united kingdom': { region: null, country: 'UK' },
  'ireland': { region: null, country: 'Ireland' },
  // Lebanon
  'lebanon': { region: null, country: 'Lebanon' },
};

function normalizePlace(placeRaw) {
  if (!placeRaw) return null;
  const tokens = String(placeRaw)
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tokens.length) return null;
  const last = tokens[tokens.length - 1].toLowerCase();
  const lookup = REGION_LOOKUP[last] || null;
  let region = lookup ? lookup.region : null;
  let country = lookup ? lookup.country : null;
  // If the last token isn't a recognized country, check the second-to-last
  // for a known region (e.g. "Brooklyn, Kings, New York, USA").
  if (!region && tokens.length >= 2) {
    const penult = tokens[tokens.length - 2].toLowerCase();
    const inner = REGION_LOOKUP[penult];
    if (inner) {
      region = inner.region;
      if (!country) country = inner.country;
    }
  }
  const city = tokens[0] || null;
  return { city, region, country, raw: placeRaw };
}

// --- Name helpers -----------------------------------------------------------

// Strip nicknames in quotes from a given-name string: 'Hugh "Jack"' -> 'Hugh'
function stripQuotedNicknames(s) {
  return String(s || '').replace(/"[^"]*"/g, '').replace(/\s+/g, ' ').trim();
}

// --- Public API -------------------------------------------------------------

function loadIndividuals(gedcomPath) {
  const buf = fs.readFileSync(gedcomPath);
  const tree = readGedcom(buf);
  const inds = tree.getIndividualRecord();
  const out = [];
  inds.arraySelect().forEach((i) => {
    const xref = i.pointer()[0];
    const nameSel = i.getName();
    const parts = nameSel.valueAsParts()[0] || [];
    const given = stripQuotedNicknames(parts[0] || '');
    const surname = (parts[1] || '').trim();

    // Surname alternates: collect _MARNM (Gramps married-name convention)
    // plus any additional NAME tags' surnames.
    const surnameAlt = new Set();
    const marnm = nameSel.get('_MARNM').value();
    marnm.forEach((v) => v && surnameAlt.add(String(v).trim()));
    // Multiple NAME tags
    const allParts = nameSel.valueAsParts();
    for (let k = 1; k < allParts.length; k++) {
      const altSurname = (allParts[k] && allParts[k][1]) || '';
      if (altSurname && altSurname !== surname) surnameAlt.add(altSurname.trim());
    }

    const sex = i.getSex().value()[0] || null;
    const birthDateRaw = i.getEventBirth().getDate().value()[0] || null;
    const birthPlaceRaw = i.getEventBirth().getPlace().value()[0] || null;
    const deathDateRaw = i.getEventDeath().getDate().value()[0] || null;
    const deathPlaceRaw = i.getEventDeath().getPlace().value()[0] || null;

    out.push({
      xref,
      given,
      surname,
      surnameAlt: [...surnameAlt],
      sex,
      birth: {
        year: extractYear(birthDateRaw),
        dateRaw: birthDateRaw,
        place: normalizePlace(birthPlaceRaw),
      },
      death: {
        year: extractYear(deathDateRaw),
        dateRaw: deathDateRaw,
        place: normalizePlace(deathPlaceRaw),
      },
    });
  });
  return out;
}

module.exports = { loadIndividuals, extractYear, normalizePlace, stripQuotedNicknames };

// String utilities used by the matcher: normalize-for-compare, classic
// Levenshtein, and a given-name initials helper for the
// `Mary J.` ↔ `Mary Jane` collapse.

function normalizeForCompare(s) {
  if (s == null) return '';
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  a = a || '';
  b = b || '';
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

// Tokenize a given-name string into normalized tokens. "Mary J." -> ["mary","j"]
function givenTokens(s) {
  return normalizeForCompare(s).split(' ').filter(Boolean);
}

// Returns the first letter of each given-name token. Used for
// "Mary J. Wilson" ↔ "Mary Jane Wilson" middle-initial collapse.
function givenInitials(s) {
  return givenTokens(s).map((t) => t[0]).join('');
}

module.exports = { normalizeForCompare, levenshtein, givenTokens, givenInitials };

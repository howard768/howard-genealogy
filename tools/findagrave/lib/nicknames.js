// Hand-curated given-name equivalence groups. Not exhaustive — focused on the
// nicknames likely to appear in this tree (English/Scottish/Irish, with a few
// French equivalents for the Quebec branch). Add more as the matcher surfaces
// them.

// Each group: first element is the canonical key. Names appear in only ONE
// group — adding a name to a second group silently overwrites the earlier
// mapping in INDEX, which has bitten us before. Test additions in tests/run.js.
const GROUPS = [
  ['john', 'jack', 'jonathan', 'johnny', 'jon', 'jean'],
  ['william', 'will', 'bill', 'billy', 'willie', 'liam'],
  ['robert', 'rob', 'bob', 'bobby', 'bert', 'robbie'],
  ['james', 'jim', 'jimmy', 'jamie'],
  ['margaret', 'maggie', 'meg', 'peggy', 'madge'],
  ['mary', 'molly', 'polly', 'mae', 'may', 'mamie', 'marie'],
  ['elizabeth', 'eliza', 'liz', 'beth', 'betty', 'betsy', 'lizzie', 'liza'],
  ['catherine', 'katherine', 'kate', 'kathy', 'cathy', 'kit', 'katie', 'cate'],
  ['patrick', 'pat', 'paddy'],
  ['michael', 'mike', 'mick', 'mickey'],
  ['charles', 'charlie', 'chuck', 'chas'],
  ['hugh', 'hughie'],
  ['isabella', 'isabel', 'isabelle', 'bella', 'izzy', 'belle'],
  ['anne', 'ann', 'anna', 'annie', 'hannah', 'nan'],
  ['thomas', 'tom', 'tommy'],
  ['edward', 'ed', 'eddie', 'ted', 'teddy', 'ned'],
  ['richard', 'rick', 'dick', 'ricky'],
  ['joseph', 'joe', 'joey', 'jos'],
  ['henry', 'harry', 'hal'],
  ['george', 'georgie'],
  ['francis', 'frank', 'frankie', 'francois', 'françois'],
  ['agnes', 'aggie', 'nessa'],
  ['sarah', 'sally', 'sadie'],
  ['frederick', 'fred', 'freddie'],
  ['alexander', 'alex', 'sandy', 'alec'],
  ['andrew', 'andy', 'drew'],
];

const INDEX = new Map();
for (const group of GROUPS) {
  const key = group[0];
  for (const name of group) INDEX.set(name, key);
}

function canonical(name) {
  if (!name) return '';
  return INDEX.get(name.toLowerCase()) || name.toLowerCase();
}

function equivalent(a, b) {
  if (!a || !b) return false;
  return canonical(a) === canonical(b);
}

module.exports = { equivalent, canonical };

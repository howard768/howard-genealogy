#!/usr/bin/env node
// Usage:
//   node search.js --first Hugh --last Wilson [--birth 1856] [--death 1906]
//                  [--location "Brooklyn, New York"] [--max 20]
//
// Scrapes the Find a Grave memorial search results page via headless Chromium
// and emits a JSON array of candidate memorials. Reusable as a library:
//
//   const { searchMemorials } = require('./search');
//   const candidates = await searchMemorials({ first, last, birthYear, deathYear, location }, { browser, max });
//
// Bails with a clear error if the search results container is missing —
// that signals Find a Grave layout drift, which must not be silently treated
// as "no match."

const { launchBrowser, newHardenedContext } = require('./lib/chromium');

const SEARCH_BASE = 'https://www.findagrave.com/memorial/search';

function buildSearchUrl({ first, last, birthYear, deathYear, location }) {
  const params = new URLSearchParams();
  if (first) params.set('firstname', first);
  if (last) params.set('lastname', last);
  if (birthYear) {
    params.set('birthyear', String(birthYear));
    params.set('birthyearfilter', '2');
  }
  if (deathYear) {
    params.set('deathyear', String(deathYear));
    params.set('deathyearfilter', '2');
  }
  if (location) params.set('location', location);
  params.set('orderby', 'r');
  return `${SEARCH_BASE}?${params.toString()}`;
}

async function searchMemorials(query, opts = {}) {
  const { max = 20 } = opts;
  let browser = opts.browser;
  const ownsBrowser = !browser;
  if (!browser) browser = await launchBrowser();
  const ctx = await newHardenedContext(browser);
  const page = await ctx.newPage();
  const url = buildSearchUrl(query);
  try {
    let response;
    try {
      response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (err) {
      return { error: 'navigation_failed', message: err.message, url };
    }
    if (!response || response.status() >= 400) {
      return { error: 'http_error', status: response ? response.status() : null, url };
    }
    try {
      await page.waitForSelector(
        '.memorial-item, [id^="srgsr"], .search-result, a[href^="/memorial/"]',
        { timeout: 15000 }
      );
    } catch (_) {
      // Fall through — may legitimately be a zero-result page.
    }
    const candidates = await page.evaluate((maxN) => {
      const norm = (t) => (t || '').trim().replace(/\s+/g, ' ');
      // Try to find memorial result cards via several selectors. FAG's markup
      // shifts; we accept any of these and dedupe on the memorial id.
      const cardSelectors = [
        '.memorial-item',
        '[id^="srgsr"]',
        '.search-result',
      ];
      let cards = [];
      for (const sel of cardSelectors) {
        const found = Array.from(document.querySelectorAll(sel));
        if (found.length) { cards = found; break; }
      }
      // Last-resort: every anchor pointing at /memorial/<id>
      if (!cards.length) {
        cards = Array.from(document.querySelectorAll('a[href*="/memorial/"]'))
          .map((a) => a.closest('article, li, div') || a);
      }
      const seen = new Set();
      const out = [];
      for (const card of cards) {
        if (out.length >= maxN) break;
        const link = card.querySelector('a[href*="/memorial/"]') ||
                     (card.matches && card.matches('a[href*="/memorial/"]') ? card : null);
        if (!link) continue;
        const m = (link.getAttribute('href') || '').match(/\/memorial\/(\d+)/);
        if (!m) continue;
        const id = m[1];
        if (seen.has(id)) continue;
        seen.add(id);

        const cardText = norm(card.textContent || '');
        // Year extraction: take the first two plausible 4-digit years
        // (1500–2100). Tolerates all FAG date layouts:
        //   "1856-1906", "1857 – 1906", "8 Jan 1930 – 18 Sep 2000"
        // Earlier regex required years on either side of a dash with no
        // intervening digits, which broke on full-date headers like Bill
        // Compston's "8 Jan 1930 – 18 Sep 2000" (the "18 Sep" between the
        // dash and 2000 stopped the match).
        const allYears = (cardText.match(/\b\d{4}\b/g) || [])
          .map((y) => parseInt(y, 10))
          .filter((y) => y >= 1500 && y <= 2100);
        let birthYear = null;
        let deathYear = null;
        if (allYears.length >= 2 && allYears[0] <= allYears[1]) {
          birthYear = allYears[0];
          deathYear = allYears[1];
        } else if (allYears.length === 1) {
          // Single year — could be birth-only (still living) or
          // death-only (unknown birth). Don't guess; leave both null
          // so the matcher applies the missing-data neutral score.
        }

        // Name: prefer the link text if it looks like a name.
        const name = norm(link.textContent) || norm(card.querySelector('h2, h3, .name')?.textContent || '');

        // Cemetery + location often appear in dedicated nodes; fall back to
        // anything mentioning "Cemetery" in the card text.
        const cemNode = card.querySelector('[class*="cemetery"], .cemetery-name, .place');
        const cemetery = cemNode ? norm(cemNode.textContent) : null;

        out.push({
          id,
          name,
          birthYear,
          deathYear,
          birthPlace: null,
          deathPlace: null,
          cemetery,
          cemeteryLocation: null,
          snippetText: cardText.slice(0, 240),
          href: link.getAttribute('href'),
        });
      }
      return { candidates: out, layoutOk: cards.length > 0 };
    }, max);

    if (!candidates.layoutOk && response.status() < 400) {
      return { error: 'layout_drift', message: 'no result containers found', url };
    }
    return candidates.candidates;
  } finally {
    await ctx.close();
    if (ownsBrowser) await browser.close();
  }
}

// ---- CLI -------------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.first && !args.last) {
    console.error('Usage: node search.js --first <given> --last <surname> [--birth Y] [--death Y] [--location "..."] [--max N]');
    process.exit(2);
  }
  const result = await searchMemorials(
    {
      first: args.first || '',
      last: args.last || '',
      birthYear: args.birth ? parseInt(args.birth, 10) : null,
      deathYear: args.death ? parseInt(args.death, 10) : null,
      location: args.location || '',
    },
    { max: args.max ? parseInt(args.max, 10) : 20 }
  );
  if (result && result.error) {
    console.error(JSON.stringify(result));
    process.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ error: 'unhandled', message: err.message }));
    process.exit(1);
  });
}

module.exports = { searchMemorials, buildSearchUrl };

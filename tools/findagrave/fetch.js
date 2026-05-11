#!/usr/bin/env node
// Usage: node fetch.js <memorial_id>
//
// Fetches a Find a Grave memorial page via headless Chromium and prints JSON
// with the structured fields (name, dates, places, cemetery, plot, family
// links, biography, JSON-LD). Exits non-zero on HTTP error or navigation
// failure.
//
// Also exports `fetchMemorial(id, opts)` so sweep.js can hydrate resolved
// memorials in-process without shelling out.
//
// Env:
//   PLAYWRIGHT_BROWSERS_PATH  Optional path to a shared browser install.
//   PLAYWRIGHT_CHROMIUM_PATH  Optional explicit path to a chrome/headless_shell
//                             binary. Use this when the system has Chromium
//                             already and you don't want `playwright install`
//                             to download another copy.
//   FAG_USER_AGENT            Optional override for the request User-Agent.
//   FAG_IGNORE_HTTPS_ERRORS   Set to "1" to ignore TLS errors (sandbox / MITM
//                             proxy environments only).

const { launchBrowser, newHardenedContext } = require('./lib/chromium');

async function fetchMemorial(memorialId, { browser } = {}) {
  if (!/^\d+$/.test(String(memorialId))) {
    throw new Error(`invalid memorial id: ${memorialId}`);
  }
  const url = `https://www.findagrave.com/memorial/${memorialId}`;
  const ownsBrowser = !browser;
  if (!browser) browser = await launchBrowser();
  const ctx = await newHardenedContext(browser);
  const page = await ctx.newPage();
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
      await page.waitForSelector('h1, [itemprop="name"], #bio-text', { timeout: 15000 });
    } catch (_) {
      // Non-fatal — capture whatever rendered.
    }
    const data = await page.evaluate(() => {
      const text = (sel) => {
        const el = document.querySelector(sel);
        return el ? el.textContent.trim().replace(/\s+/g, ' ') : null;
      };
      const attr = (sel, a) => {
        const el = document.querySelector(sel);
        return el ? el.getAttribute(a) : null;
      };
      const jsonLd = [];
      document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
        try { jsonLd.push(JSON.parse(s.textContent)); } catch (_) {}
      });
      const familyLinks = [];
      const seen = new Set();
      document.querySelectorAll('a[href*="/memorial/"]').forEach((a) => {
        const href = a.getAttribute('href') || '';
        const m = href.match(/\/memorial\/(\d+)/);
        if (!m) return;
        const key = m[1] + '|' + a.textContent.trim();
        if (seen.has(key)) return;
        seen.add(key);
        familyLinks.push({
          id: m[1],
          text: a.textContent.trim().replace(/\s+/g, ' '),
          href,
        });
      });
      return {
        title: document.title,
        h1: text('h1'),
        name: text('[itemprop="name"]'),
        birthDate:
          text('[itemprop="birthDate"]') || attr('[itemprop="birthDate"]', 'datetime'),
        birthPlace: text('[itemprop="birthPlace"]'),
        deathDate:
          text('[itemprop="deathDate"]') || attr('[itemprop="deathDate"]', 'datetime'),
        deathPlace: text('[itemprop="deathPlace"]'),
        cemetery: text('#cemeteryNameLabel, [itemprop="name"][itemtype*="Cemetery"]'),
        cemeteryLocation: text('#cemeteryAddressLabel, [itemprop="address"]'),
        plot: text('#plotValueLabel'),
        memorialIdShown: text('#memNumberLabel'),
        bio: text('#fullBio') || text('#partialBio'),
        inscription: text('#inscriptionValue'),
        familyLinks,
        jsonLd,
      };
    });
    data.memorialIdRequested = String(memorialId);
    data.url = url;
    data.fetchedAt = new Date().toISOString();
    return data;
  } finally {
    await ctx.close();
    if (ownsBrowser) await browser.close();
  }
}

async function main() {
  const memorialId = process.argv[2];
  if (!memorialId || !/^\d+$/.test(memorialId)) {
    console.error('Usage: node fetch.js <memorial_id>');
    process.exit(2);
  }
  const result = await fetchMemorial(memorialId);
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

module.exports = { fetchMemorial };

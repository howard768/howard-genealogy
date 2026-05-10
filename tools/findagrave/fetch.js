#!/usr/bin/env node
// Usage: node fetch.js <memorial_id>
//
// Fetches a Find a Grave memorial page via headless Chromium and prints JSON
// with the structured fields (name, dates, places, cemetery, plot, family
// links, biography, JSON-LD). Exits non-zero on HTTP error or navigation
// failure.
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

const fs = require('fs');
const { chromium } = require('playwright');

const memorialId = process.argv[2];
if (!memorialId || !/^\d+$/.test(memorialId)) {
  console.error('Usage: node fetch.js <memorial_id>');
  process.exit(2);
}

const url = `https://www.findagrave.com/memorial/${memorialId}`;
const userAgent =
  process.env.FAG_USER_AGENT ||
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function resolveChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !fs.existsSync(root)) return null;
  const candidates = fs
    .readdirSync(root)
    .filter((n) => n.startsWith('chromium_headless_shell-') || n.startsWith('chromium-'))
    .sort()
    .reverse();
  for (const dir of candidates) {
    const headless = `${root}/${dir}/chrome-linux/headless_shell`;
    if (fs.existsSync(headless)) return headless;
    const full = `${root}/${dir}/chrome-linux/chrome`;
    if (fs.existsSync(full)) return full;
  }
  return null;
}

(async () => {
  const launchOpts = { headless: true };
  const exe = resolveChromium();
  if (exe) launchOpts.executablePath = exe;
  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext({
    userAgent,
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    ignoreHTTPSErrors: process.env.FAG_IGNORE_HTTPS_ERRORS === '1',
  });
  const page = await ctx.newPage();

  let response;
  try {
    response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (err) {
    console.error(JSON.stringify({ error: 'navigation_failed', message: err.message, url }));
    await browser.close();
    process.exit(1);
  }

  if (!response || response.status() >= 400) {
    console.error(
      JSON.stringify({
        error: 'http_error',
        status: response ? response.status() : null,
        url,
      })
    );
    await browser.close();
    process.exit(1);
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
      try {
        jsonLd.push(JSON.parse(s.textContent));
      } catch (_) {}
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

  data.memorialIdRequested = memorialId;
  data.url = url;
  data.fetchedAt = new Date().toISOString();

  console.log(JSON.stringify(data, null, 2));
  await browser.close();
})().catch((err) => {
  console.error(JSON.stringify({ error: 'unhandled', message: err.message }));
  process.exit(1);
});

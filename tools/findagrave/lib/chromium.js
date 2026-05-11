// Shared Chromium resolution + browser/context construction for fetch.js,
// search.js, and sweep.js. Centralized here so the three entry points stay
// in lockstep on user-agent, viewport, locale, and the
// system-Chromium-vs-bundled choice.

const fs = require('fs');
const { chromium } = require('playwright');

const DEFAULT_USER_AGENT =
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

async function launchBrowser({ headless = true } = {}) {
  const opts = { headless };
  const exe = resolveChromium();
  if (exe) opts.executablePath = exe;
  return chromium.launch(opts);
}

async function newHardenedContext(browser) {
  return browser.newContext({
    userAgent: process.env.FAG_USER_AGENT || DEFAULT_USER_AGENT,
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    ignoreHTTPSErrors: process.env.FAG_IGNORE_HTTPS_ERRORS === '1',
  });
}

module.exports = { resolveChromium, launchBrowser, newHardenedContext };

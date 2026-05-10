#!/usr/bin/env node
// Usage:
//   node sweep.js <gedcom-path>
//     [--cache out/cache.jsonl] [--report out/report.md]
//     [--only <xref>] [--re-search-ambiguous] [--re-search-all]
//     [--hydrate] [--delay-ms 4000] [--jitter-ms 2000]
//     [--max-candidates 20] [--limit N]
//
// GEDCOM-driven driver. For each individual: search Find a Grave, score
// candidates, decide resolved/ambiguous/no_match, append a row to the JSONL
// cache. Re-runs are idempotent — already-resolved individuals are skipped
// unless --re-search-all is passed.
//
// Strictly serial. One in-flight request. Single Browser reused across the
// whole sweep; new Context per individual to avoid cookie carryover.

const fs = require('fs');
const path = require('path');
const { loadIndividuals } = require('./lib/gedcom');
const { launchBrowser } = require('./lib/chromium');
const { searchMemorials } = require('./search');
const { pickBest } = require('./match');
const { fetchMemorial } = require('./fetch');

// ---- CLI parsing -----------------------------------------------------------

function parseArgs(argv) {
  const out = { _: [] };
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
    } else {
      out._.push(a);
    }
  }
  return out;
}

// ---- Cache I/O -------------------------------------------------------------

function loadCache(cachePath) {
  const map = new Map();
  if (!fs.existsSync(cachePath)) return map;
  const lines = fs.readFileSync(cachePath, 'utf8').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.xref) map.set(row.xref, row);
    } catch (_) {
      // Tolerate malformed lines from manual editing.
    }
  }
  return map;
}

function rewriteCache(cachePath, map) {
  const dir = path.dirname(cachePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = cachePath + '.tmp';
  const lines = [...map.values()].map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(tmp, lines);
  fs.renameSync(tmp, cachePath);
}

// ---- Pipeline --------------------------------------------------------------

function buildQuery(individual) {
  const location = locationHint(individual);
  return {
    first: (individual.given || '').split(' ')[0] || '',
    last: individual.surname || '',
    birthYear: individual.birth.year,
    deathYear: individual.death.year,
    location,
  };
}

function locationHint(individual) {
  const place = (individual.death && individual.death.place) || (individual.birth && individual.birth.place);
  if (!place) return '';
  return [place.city, place.region, place.country].filter(Boolean).join(', ');
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

function shouldProcess(existing, opts) {
  if (!existing) return true;
  if (opts['re-search-all']) return true;
  if (existing.status === 'ambiguous' && opts['re-search-ambiguous']) return true;
  if (existing.status === 'error') return true; // errors are non-terminal
  return false;
}

async function processIndividual(browser, individual, opts) {
  const query = buildQuery(individual);
  const maxCandidates = opts['max-candidates'] ? parseInt(opts['max-candidates'], 10) : 20;
  let result;
  let attempt = 0;
  for (;;) {
    attempt++;
    const candidates = await searchMemorials(query, { browser, max: maxCandidates });
    if (candidates && candidates.error === 'http_error' && candidates.status === 403 && attempt === 1) {
      console.error(`  ! 403 on ${individual.xref}; sleeping 60s then retrying once`);
      await delay(60000);
      continue;
    }
    if (candidates && candidates.error) {
      result = {
        xref: individual.xref,
        name: `${individual.given} ${individual.surname}`.trim(),
        query,
        status: 'error',
        error: candidates.error,
        message: candidates.message || null,
        searchedAt: new Date().toISOString(),
      };
      return result;
    }
    const decision = pickBest(individual, candidates);
    result = {
      xref: individual.xref,
      name: `${individual.given} ${individual.surname}`.trim(),
      birth: individual.birth,
      death: individual.death,
      query,
      status: decision.status,
      memorialId: decision.memorialId || null,
      score: decision.score || null,
      gap: decision.gap || null,
      reasons: decision.reasons || [],
      candidates: decision.candidates || [],
      searchedAt: new Date().toISOString(),
      hydratedAt: null,
    };
    return result;
  }
}

// ---- Hydration -------------------------------------------------------------

async function hydrateResolved(browser, cacheMap, outDir) {
  const memorialsDir = path.join(outDir, 'memorials');
  if (!fs.existsSync(memorialsDir)) fs.mkdirSync(memorialsDir, { recursive: true });
  let n = 0;
  for (const row of cacheMap.values()) {
    if (row.status !== 'resolved' || row.hydratedAt) continue;
    if (!row.memorialId) continue;
    const data = await fetchMemorial(row.memorialId, { browser });
    if (data && data.error) {
      console.error(`  ! hydrate failed for ${row.memorialId}: ${data.error}`);
      continue;
    }
    fs.writeFileSync(path.join(memorialsDir, `${row.memorialId}.json`), JSON.stringify(data, null, 2));
    row.hydratedAt = new Date().toISOString();
    n++;
  }
  return n;
}

// ---- Report ----------------------------------------------------------------

function renderReport(cacheMap) {
  const rows = [...cacheMap.values()];
  const resolved = rows.filter((r) => r.status === 'resolved');
  const ambiguous = rows.filter((r) => r.status === 'ambiguous');
  const noMatch = rows.filter((r) => r.status === 'no_match');
  const errors = rows.filter((r) => r.status === 'error');

  const lines = [];
  lines.push(`# Find a Grave sweep — ${new Date().toISOString().slice(0, 10)}`);
  lines.push('');
  lines.push(`${rows.length} individuals processed. ${resolved.length} resolved, ${ambiguous.length} ambiguous, ${noMatch.length} no match, ${errors.length} errors.`);
  lines.push('');

  lines.push(`## Resolved (${resolved.length})`);
  lines.push('');
  if (resolved.length) {
    lines.push('| GEDCOM xref | Name | Birth | Death | Memorial | Score |');
    lines.push('|---|---|---|---|---|---|');
    for (const r of resolved) {
      const b = r.birth && r.birth.year || '';
      const d = r.death && r.death.year || '';
      lines.push(`| ${r.xref} | ${r.name} | ${b} | ${d} | [${r.memorialId}](https://www.findagrave.com/memorial/${r.memorialId}) | ${r.score} |`);
    }
    lines.push('');
  }

  lines.push(`## Ambiguous — needs manual review (${ambiguous.length})`);
  lines.push('');
  for (const r of ambiguous) {
    const b = r.birth && r.birth.year || '?';
    const d = r.death && r.death.year || '?';
    const placeHint = (r.death && r.death.place && r.death.place.raw) || (r.birth && r.birth.place && r.birth.place.raw) || '';
    lines.push(`### ${r.xref} ${r.name}  (b. ${b}, d. ${d}${placeHint ? ', ' + placeHint : ''})`);
    lines.push('');
    lines.push('Top candidates:');
    r.candidates.forEach((c, i) => {
      lines.push(`${i + 1}. **${c.name}** ${c.birthYear || '?'}–${c.deathYear || '?'}${c.cemetery ? `, ${c.cemetery}` : ''} — score ${c.score} — [memorial/${c.id}](https://www.findagrave.com/memorial/${c.id})`);
    });
    lines.push('');
    lines.push(`To accept candidate 1, edit \`out/cache.jsonl\`: set \`status\` to \`resolved\` and \`memorialId\` to the chosen id.`);
    lines.push('');
  }

  lines.push(`## No match (${noMatch.length})`);
  lines.push('');
  if (noMatch.length) {
    lines.push('<details><summary>Expand list</summary>');
    lines.push('');
    for (const r of noMatch) {
      const b = r.birth && r.birth.year || '?';
      const d = r.death && r.death.year || '?';
      const placeHint = (r.birth && r.birth.place && r.birth.place.raw) || (r.death && r.death.place && r.death.place.raw) || '';
      lines.push(`- ${r.xref} ${r.name} (${b}–${d}${placeHint ? ', ' + placeHint : ''})`);
    }
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }

  if (errors.length) {
    lines.push(`## Errors (${errors.length})`);
    lines.push('');
    for (const r of errors) {
      lines.push(`- ${r.xref} ${r.name}: ${r.error}${r.message ? ' — ' + r.message : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ---- Main ------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const gedcomPath = args._[0];
  if (!gedcomPath) {
    console.error('Usage: node sweep.js <gedcom-path> [options]');
    process.exit(2);
  }
  const cachePath = args.cache || 'out/cache.jsonl';
  const reportPath = args.report || 'out/report.md';
  const outDir = path.dirname(cachePath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const baseDelay = args['delay-ms'] ? parseInt(args['delay-ms'], 10) : 4000;
  const jitter = args['jitter-ms'] ? parseInt(args['jitter-ms'], 10) : 2000;
  const limit = args.limit ? parseInt(args.limit, 10) : null;
  const onlyXref = args.only || null;

  const individuals = loadIndividuals(gedcomPath);
  const cacheMap = loadCache(cachePath);

  const browser = await launchBrowser();
  try {
    let processed = 0;
    let skipped = 0;
    for (const ind of individuals) {
      if (limit != null && processed >= limit) break;
      if (onlyXref && ind.xref !== onlyXref) { skipped++; continue; }
      const existing = cacheMap.get(ind.xref);
      if (!shouldProcess(existing, args)) { skipped++; continue; }

      console.error(`[${processed + 1}] ${ind.xref} ${ind.given} ${ind.surname}`);
      const result = await processIndividual(browser, ind, args);
      cacheMap.set(ind.xref, { ...(existing || {}), ...result });
      rewriteCache(cachePath, cacheMap);
      processed++;
      console.error(`  → ${result.status}${result.memorialId ? ' (' + result.memorialId + ')' : ''}${result.score != null ? ' score=' + result.score : ''}`);

      // Polite delay before the next individual.
      await delay(baseDelay + Math.floor(Math.random() * jitter));
    }
    console.error(`\nSweep summary: ${processed} processed, ${skipped} skipped.`);

    if (args.hydrate) {
      console.error('\nHydrating resolved memorials...');
      const n = await hydrateResolved(browser, cacheMap, outDir);
      rewriteCache(cachePath, cacheMap);
      console.error(`Hydrated ${n} memorials.`);
    }
  } finally {
    await browser.close();
  }

  fs.writeFileSync(reportPath, renderReport(cacheMap));
  console.error(`Report written to ${reportPath}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('FATAL:', err && err.stack || err);
    process.exit(1);
  });
}

module.exports = { renderReport, loadCache, buildQuery };

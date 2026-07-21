#!/usr/bin/env node
/**
 * matrix-report — print a compact CLI table from compat-matrix.json.
 *
 * Usage:
 *   node scripts/matrix-report.js
 *   node scripts/matrix-report.js --json                          # machine-readable summary
 *   node scripts/matrix-report.js --cell 4.6.3+3.9.4+main         # filter to one cell
 *   node scripts/matrix-report.js --diff <base> <candidate>       # per-surface delta between two cells
 *
 * Reads `compat-matrix.json` from the repo root. Each row is a probe of one
 * surface under one plugin-version cell (Free+Pro+Chatbot). Groups by cell,
 * counts silent breaks, prints a compact table.
 *
 * The `--diff` mode compares every surface between two cells and prints
 * regressions (was ok → now broken), fixes (was broken → now ok), and
 * status quo. Useful when you swap a plugin build and want to know exactly
 * what changed *design-wise* — signal beyond a raw pass/fail.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '..', 'compat-matrix.json');
if (!fs.existsSync(FILE)) {
    console.error(`compat-matrix.json not found at ${FILE}\nRun the compat-matrix project first.`);
    process.exit(2);
}
const rows = JSON.parse(fs.readFileSync(FILE, 'utf8'));
if (!Array.isArray(rows) || rows.length === 0) {
    console.error('compat-matrix.json is empty.');
    process.exit(2);
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const cellFilterIx = args.indexOf('--cell');
const cellFilter = cellFilterIx >= 0 ? args[cellFilterIx + 1] : null;
const diffIx = args.indexOf('--diff');
const diffBase = diffIx >= 0 ? args[diffIx + 1] : null;
const diffCandidate = diffIx >= 0 ? args[diffIx + 2] : null;

// ── DIFF MODE ─────────────────────────────────────────────────────────
if (diffBase && diffCandidate) {
    const bySurface = (cell) => {
        const m = new Map();
        for (const r of rows.filter((x) => x.cell === cell)) m.set(r.surface, r);
        return m;
    };
    const A = bySurface(diffBase);
    const B = bySurface(diffCandidate);
    if (A.size === 0) { console.error(`No rows found for base cell "${diffBase}"`); process.exit(2); }
    if (B.size === 0) { console.error(`No rows found for candidate cell "${diffCandidate}"`); process.exit(2); }
    const surfaces = new Set([...A.keys(), ...B.keys()]);
    console.log(`\nDiff: ${diffBase}  →  ${diffCandidate}\n`);
    let regressed = 0, fixed = 0, sameBroken = 0, sameOk = 0;
    for (const s of Array.from(surfaces).sort()) {
        const a = A.get(s), b = B.get(s);
        const aBroken = a?.has_broken_surface, bBroken = b?.has_broken_surface;
        const aSilent = a?.silent_break, bSilent = b?.silent_break;
        let flag = '  ';
        if (aBroken && !bBroken) { flag = '✓ FIXED     '; fixed++; }
        else if (!aBroken && bBroken) { flag = '✗ REGRESSED'; regressed++; }
        else if (aBroken && bBroken) { flag = '~ still-brk'; sameBroken++; }
        else { flag = '  ok       '; sameOk++; }
        const detail = b ? `root ${a?.spa_root_height ?? '-'}→${b.spa_root_height}px, err ${a?.console_errors?.length ?? '-'}→${b.console_errors.length}, silent ${aSilent?'y':'n'}→${bSilent?'y':'n'}` : '(missing in candidate)';
        console.log(` ${flag}  ${s.padEnd(28)} ${detail}`);
    }
    console.log(`\nregressed=${regressed}  fixed=${fixed}  same-broken=${sameBroken}  same-ok=${sameOk}`);
    process.exit(regressed > 0 ? 1 : 0);
}
// ── END DIFF MODE ─────────────────────────────────────────────────────

const filtered = cellFilter ? rows.filter((r) => r.cell === cellFilter) : rows;
if (filtered.length === 0) {
    console.error(`No rows match cell "${cellFilter}"`);
    process.exit(2);
}

const byCell = new Map();
for (const r of filtered) {
    if (!byCell.has(r.cell)) byCell.set(r.cell, []);
    byCell.get(r.cell).push(r);
}

if (asJson) {
    const summary = {};
    for (const [cell, cellRows] of byCell) {
        summary[cell] = {
            surfaces_sampled: cellRows.length,
            broken: cellRows.filter((r) => r.has_broken_surface).length,
            silent_breaks: cellRows.filter((r) => r.silent_break).length,
            broken_surfaces: cellRows.filter((r) => r.has_broken_surface).map((r) => r.surface),
            silent_break_surfaces: cellRows.filter((r) => r.silent_break).map((r) => r.surface),
        };
    }
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
}

// Human-readable table.
const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);
const HEADER = pad('CELL', 30) + ' | ' + rpad('SURF', 4) + ' | ' + rpad('BROKEN', 6) + ' | ' + rpad('SILENT', 6) + ' | ' + 'BROKEN SURFACES';
console.log('\n' + HEADER);
console.log('-'.repeat(HEADER.length));
let totalSilent = 0;
for (const [cell, cellRows] of byCell) {
    const broken = cellRows.filter((r) => r.has_broken_surface);
    const silent = cellRows.filter((r) => r.silent_break);
    totalSilent += silent.length;
    const brokenList = broken.map((r) => r.surface + (r.silent_break ? '⚠' : '')).join(', ') || '-';
    console.log(pad(cell, 30) + ' | ' + rpad(cellRows.length, 4) + ' | ' + rpad(broken.length, 6) + ' | ' + rpad(silent.length, 6) + ' | ' + brokenList);
}
console.log('-'.repeat(HEADER.length));
console.log(`\n${byCell.size} cell(s), ${totalSilent} silent break(s) total.`);
console.log('\nLegend:');
console.log(' ⚠  surface broke AND no compatibility notice explained why (design failure)');
console.log(' -  no broken surface in the cell');
console.log('');
console.log(`Data: ${path.relative(process.cwd(), FILE)}`);
process.exit(totalSilent > 0 ? 1 : 0);

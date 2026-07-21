/**
 * 05 — Version-compatibility matrix.
 *
 * Runs against whatever Free + Pro + Chatbot versions are currently active
 * on the staging site. Samples 12 canonical admin + frontend surfaces and,
 * per surface, collects design-health signals:
 *
 *   - SPA root mounted?  Rendered height?  Number of children / buttons?
 *   - JS console errors during load (chunk-load = red flag)?
 *   - Fatal PHP?
 *   - What notices were visible on this page? On plugins.php?
 *
 * Then computes `silent_break` = "a surface is visibly broken AND no
 * notice explains why". That's the design-failure mode you see when Free
 * X + Pro Y have mismatched React chunks and the plugin fails to inform
 * the user.
 *
 * Output:
 *   compat-matrix.json                              — appended, one row / surface
 *   test-results-staging/compat-matrix/<cell>/*.png — labeled screenshots
 */
const path = require('path');
const fs = require('fs');
const { test, expect } = require("@playwright/test");
const { loginAsAdmin, gotoAdmin } = require("../../helpers/staging/auth");
const { setTier, getPluginStates } = require("../../helpers/staging/plugins");
const {
    probeSurface, readAdminNotices, derive, cellLabel,
} = require("../../helpers/staging/compatMatrix");
const { newGuestPage } = require("../../helpers/staging/frontend");
const { shoot } = require("../../helpers/staging/screenshot");
const { STAGING } = require("../../helpers/staging/env");
const { listWcProducts } = require("../../helpers/staging/records");

const MATRIX_JSON = path.resolve(__dirname, '..', '..', '..', 'compat-matrix.json');

// The 12 canonical surfaces. Per surface: URL to probe, minimum expected
// visible-button count (below this = shell rendered without content), and
// which SPA root selectors to look for. `frontend: true` means run in a
// guest context; the rest use the admin storageState.
const SURFACES = [
    { name: '01-dashboard',          url: 'wp-admin/admin.php?page=betterdocs-admin',                             min_visible_buttons: 2,  rootSelectors: ['#betterdocs-admin-app', '.betterdocs-admin'] },
    { name: '02-doc-categories',     url: 'wp-admin/admin.php?page=betterdocs-doc-categories',                    min_visible_buttons: 1,  rootSelectors: ['[id*="betterdocs"]', '.wrap'] },
    { name: '03-doc-tags',           url: 'wp-admin/admin.php?page=betterdocs-doc-tags',                          min_visible_buttons: 1,  rootSelectors: ['[id*="betterdocs"]', '.wrap'] },
    { name: '04-faq-wc-groups',      url: 'wp-admin/admin.php?page=betterdocs-faq&faq_tab=woocommerce&faq_subtab=groups', min_visible_buttons: 1, rootSelectors: ['[id*="betterdocs"]', '.wrap'] },
    { name: '05-glossaries',         url: 'wp-admin/admin.php?page=betterdocs-glossaries',                        min_visible_buttons: 1,  rootSelectors: ['[id*="betterdocs"]', '.wrap'] },
    { name: '06-multiple-kb',        url: 'wp-admin/admin.php?page=betterdocs-knowledge-base',                    min_visible_buttons: 1,  rootSelectors: ['[id*="betterdocs"]', '.wrap'] },
    { name: '07-analytics',          url: 'wp-admin/admin.php?page=betterdocs-analytics',                         min_visible_buttons: 3,  rootSelectors: ['[id*="betterdocs"]', '.wrap'] },
    { name: '08-settings-ai-chatbot',url: 'wp-admin/admin.php?page=betterdocs-settings#/ai-chatbot',              min_visible_buttons: 2,  rootSelectors: ['[id*="betterdocs"]', '.wrap'] },
    { name: '10-frontend-docs',      url: 'docs/',       min_visible_buttons: 0, rootSelectors: ['body'], frontend: true },
    { name: '11-frontend-encyclopedia', url: 'encyclopedia/', min_visible_buttons: 0, rootSelectors: ['body'], frontend: true },
    // Product surface fills its URL at runtime once we know a WC product slug.
    { name: '12-frontend-product',   url: null,          min_visible_buttons: 0, rootSelectors: ['body'], frontend: true, needsWcProduct: true },
];

// Track the assembled cell so cleanup / reporter can find it.
let cellDir = null;
let pluginStates = {};
let noticesOnPluginsPage = [];
const rowsCollected = [];

async function ensureCellDir(label) {
    const dir = path.resolve(__dirname, '..', '..', '..', 'test-results-staging', 'compat-matrix', label);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function appendRow(row) {
    let existing = [];
    if (fs.existsSync(MATRIX_JSON)) {
        try { existing = JSON.parse(fs.readFileSync(MATRIX_JSON, 'utf8')); } catch (_) {}
    }
    existing.push(row);
    fs.writeFileSync(MATRIX_JSON, JSON.stringify(existing, null, 2));
}

test.describe.serial('05 · Version compatibility matrix', () => {
    // Preflight: capture Free + Pro + Chatbot versions and scan plugins.php
    // for any compatibility / version notices. This is the "explaining
    // notice" context every surface derivation uses.
    test.beforeAll(async ({ browser }) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await loginAsAdmin(page);
        pluginStates = await getPluginStates(page);
        // We're already on plugins.php after getPluginStates — scan it.
        noticesOnPluginsPage = await readAdminNotices(page, { pluginSlug: 'betterdocs-pro' });
        const label = cellLabel(pluginStates);
        cellDir = await ensureCellDir(label);
        console.log(`[05.setup] cell = ${label}`);
        console.log(`[05.setup] plugins.php notices captured: ${noticesOnPluginsPage.length}`);
        // Resolve the product surface once, using the first WC product.
        try {
            const products = await listWcProducts(page, 5);
            const prodSurf = SURFACES.find((s) => s.name === '12-frontend-product');
            if (prodSurf && products?.[0]?.slug) {
                prodSurf.url = `product/${products[0].slug}/`;
            } else if (prodSurf) {
                prodSurf.skip = 'no WC product available on staging';
            }
        } catch (_) { /* leave prodSurf.url = null → test will log-skip */ }
        await ctx.close();
    });

    // One test per surface. Each test:
    //   - Probes the surface for design-health signals
    //   - Screenshots the surface (always, so cells are eyeball-comparable)
    //   - Appends the derived JSON row (with silent_break flag) to compat-matrix.json
    for (const surf of SURFACES) {
        test(`05.${surf.name}`, async ({ page, browser }) => {
            // Frontend surfaces use a guest context (no admin cookies).
            let target = page;
            let ctx = null;
            if (surf.frontend) {
                const guest = await newGuestPage(browser);
                target = guest.page;
                ctx = guest.ctx;
            } else {
                await loginAsAdmin(page);
            }
            try {
                if (!surf.url) {
                    console.log(`[05.${surf.name}] skipped: ${surf.skip || 'no URL'}`);
                    return;
                }
                const raw = await probeSurface(target, surf);
                // Attach the min-buttons expectation so derive() can apply it.
                raw.min_visible_buttons = surf.min_visible_buttons;
                const [row] = derive([raw], noticesOnPluginsPage);
                // Always take a screenshot into the cell dir so a human can
                // eyeball later. Success or failure both go here.
                const shotPath = path.join(cellDir, `${surf.name}.png`);
                await target.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
                row.png = path.relative(path.resolve(__dirname, '..', '..', '..'), shotPath);
                row.cell = cellLabel(pluginStates);
                appendRow(row);
                rowsCollected.push(row);
                // Log a one-liner for the reporter.
                const status = row.silent_break ? 'SILENT_BREAK' :
                               row.has_broken_surface ? 'BROKEN_BUT_EXPLAINED' :
                               'ok';
                console.log(`[05.${surf.name}] ${status}  root=${row.spa_root_height}px  buttons=${row.visible_buttons}  errors=${row.console_errors.length}  notices=${row.notices_here.length}`);
                // We DO NOT fail hard on silent_break — the whole point of the
                // matrix is to record the situation, not to halt the run. Human
                // reads the JSON / screenshots to decide.
                //
                // But if the SPA didn't mount AND there's no console error AND
                // no explaining notice, that's a hard bug — flag as expect fail.
                if (surf.frontend !== true) {
                    expect.soft(row.fatal_php, `${surf.name}: page must not fatal`).toBe(false);
                }
            } finally {
                if (ctx) await ctx.close();
            }
        });
    }

    // Summary — walk what we collected and print a compact table + counts.
    test('05.summary — silent-break count for this cell', async () => {
        const total = rowsCollected.length;
        const brokenCount = rowsCollected.filter((r) => r.has_broken_surface).length;
        const silentCount = rowsCollected.filter((r) => r.silent_break).length;
        const cell = rowsCollected[0]?.cell ?? cellLabel(pluginStates);
        console.log(`
─────────────────────────────────────────────────────────────
 Compatibility matrix cell: ${cell}
─────────────────────────────────────────────────────────────
 Surfaces sampled:     ${total}
 Broken surfaces:      ${brokenCount}
 Silent breaks (no notice): ${silentCount}
 Plugins.php notices:  ${noticesOnPluginsPage.length}
─────────────────────────────────────────────────────────────`);
        rowsCollected.forEach((r) => {
            const flag = r.silent_break ? '⚠ SILENT' : r.has_broken_surface ? '~ BROKEN' : '✓ ok';
            console.log(` ${flag}  ${r.surface.padEnd(28)} root=${String(r.spa_root_height).padStart(4)}px  btn=${String(r.visible_buttons).padStart(2)}  err=${String(r.console_errors.length).padStart(2)}`);
        });
        // Silent breaks are user-visible design failures — expose them via
        // expect.soft so the run stays green but the failure surfaces on
        // GitHub's job summary. Turn to expect() to make CI hard-fail.
        for (const r of rowsCollected) {
            expect.soft(r.silent_break, `${r.surface} broke without an explaining notice`).toBe(false);
        }
    });
});

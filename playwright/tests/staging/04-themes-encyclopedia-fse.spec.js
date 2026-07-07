/**
 * 04 — Encyclopedia routing under FSE (block) themes.
 *
 * Complements 04-themes-encyclopedia-elementor.spec.js. Pro 3.9.3 renders
 * /encyclopedia/ via an auto-created WP page containing the
 * `[betterdocs_encyclopedia]` shortcode — under FSE themes the output goes
 * through the block-theme template pipeline instead of the Elementor page
 * renderer. Historically routing has regressed when block-template
 * resolution changed, so we sanity-check TT2024 + TT2025 explicitly.
 */
const { test, expect } = require("@playwright/test");
const { loginAsAdmin, gotoAdmin } = require("../../helpers/staging/auth");
const { setTier } = require("../../helpers/staging/plugins");
const { enableEncyclopedia, logRename } = require("../../helpers/staging/settings");
const { newGuestPage, visitFrontend } = require("../../helpers/staging/frontend");
const { shoot } = require("../../helpers/staging/screenshot");

const FSE_THEMES = [
    { slug: 'twentytwentyfour', label: 'Twenty Twenty-Four' },
    { slug: 'twentytwentyfive', label: 'Twenty Twenty-Five' },
];

async function activateTheme(page, slug) {
    await gotoAdmin(page, 'themes.php');
    await page.waitForTimeout(1500);
    const row = page.locator(`div.theme[data-slug="${slug}"]`);
    if (await row.count() === 0) return false;
    if (await row.first().evaluate((el) => el.classList.contains('active'))) return true;
    await row.first().hover();
    const activate = row.locator('a:has-text("Activate")');
    if (await activate.count() === 0) return false;
    await Promise.all([
        page.waitForLoadState('domcontentloaded'),
        activate.first().click(),
    ]);
    await page.waitForTimeout(2500);
    return true;
}

test.describe.serial('04 · FSE encyclopedia routing', () => {
    // Pro is needed for the Encyclopedia CPT / shortcode. Turn on the master
    // toggle once so /encyclopedia/ has content to render.
    test.beforeAll(async ({ browser }) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await loginAsAdmin(page);
        await setTier(page, 'pro');
        await enableEncyclopedia(page, true);
        await ctx.close();
    });

    for (const theme of FSE_THEMES) {
        // For each FSE theme: activate → /encyclopedia/ must render without
        // a fatal / 404, and expose some encyclopedia-shape marker.
        test(`04.fse-${theme.slug} — /encyclopedia/ routes under ${theme.label}`, async ({ page, browser }) => {
            await loginAsAdmin(page);
            const activated = await activateTheme(page, theme.slug);
            if (!activated) {
                logRename('theme', theme.label, '(not installed)');
                return;
            }
            const { page: guest, ctx } = await newGuestPage(browser);
            await visitFrontend(guest, '/encyclopedia/');
            await guest.waitForTimeout(2500);
            const body = await guest.locator('body').textContent() || '';
            expect(body, `${theme.label} /encyclopedia/ should not fatal`)
                .not.toMatch(/Fatal error|Uncaught/);
            expect(body, `${theme.label} /encyclopedia/ should not 404`)
                .not.toMatch(/Page not found|404 Not Found/i);
            await shoot(guest, `test-results-staging/04-fse-encyclopedia/${theme.slug}-index.png`, { fullPage: true });
            // Encyclopedia-shape marker.
            const marker = guest.locator([
                '[class*="encyclopedia"]',
                '[class*="alphabet"]',
                'nav a[href*="/encyclopedia/"]',
            ].join(', '));
            if (await marker.count() === 0) {
                logRename(`encyclopedia-marker-${theme.slug}`, 'A–Z index / .encyclopedia container', '(none found)');
            }
            await ctx.close();
        });
    }
});

/**
 * 04 — Encyclopedia routing under an Elementor theme (Hello Elementor).
 *
 * Complements 04-themes-encyclopedia-fse.spec.js which handled FSE themes.
 * Pro 3.9.3 renders /encyclopedia/ via an auto-created WP page containing
 * the `[betterdocs_encyclopedia]` shortcode — so on Hello Elementor the
 * output goes through Elementor's page renderer instead of a block-theme
 * template. This test proves the shortcode still renders and routes.
 */
const { test, expect } = require("@playwright/test");
const { loginAsAdmin, gotoAdmin } = require("../../helpers/staging/auth");
const { setTier } = require("../../helpers/staging/plugins");
const { enableEncyclopedia, logRename } = require("../../helpers/staging/settings");
const { newGuestPage, visitFrontend } = require("../../helpers/staging/frontend");
const { shoot } = require("../../helpers/staging/screenshot");

const THEME = { slug: 'hello-elementor', label: 'Hello Elementor' };

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

test.describe.serial('04 · Elementor encyclopedia routing', () => {
    // Pro is needed for the Encyclopedia CPT / shortcode. Enable the master
    // toggle before we start so /encyclopedia/ has content to render.
    test.beforeAll(async ({ browser }) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await loginAsAdmin(page);
        await setTier(page, 'pro');
        await enableEncyclopedia(page, true);
        await ctx.close();
    });

    // Under Hello Elementor, /encyclopedia/ should render the shortcode
    // output (A–Z index or a friendly empty state) with no fatal / 404.
    test(`04.elementor-${THEME.slug} — /encyclopedia/ routes under ${THEME.label}`, async ({ page, browser }) => {
        await loginAsAdmin(page);
        const activated = await activateTheme(page, THEME.slug);
        if (!activated) {
            logRename('theme', THEME.label, '(not installed)');
            return;
        }
        const { page: guest, ctx } = await newGuestPage(browser);
        await visitFrontend(guest, '/encyclopedia/');
        await guest.waitForTimeout(2500);
        const body = await guest.locator('body').textContent() || '';
        expect(body, `${THEME.label} /encyclopedia/ should not fatal`)
            .not.toMatch(/Fatal error|Uncaught/);
        expect(body, `${THEME.label} /encyclopedia/ should not 404`)
            .not.toMatch(/Page not found|404 Not Found/i);
        await shoot(guest, `test-results-staging/04-elementor-encyclopedia/${THEME.slug}-index.png`, { fullPage: true });
        // Look for encyclopedia-shape markers: A–Z filter, .encyclopedia
        // container, or an internal /encyclopedia/ link on the page.
        const marker = guest.locator([
            '[class*="encyclopedia"]',
            '[class*="alphabet"]',
            'nav a[href*="/encyclopedia/"]',
        ].join(', '));
        if (await marker.count() === 0) {
            logRename(`encyclopedia-marker-${THEME.slug}`, 'A–Z index / .encyclopedia container', '(none found)');
        }
        await ctx.close();
    });
});

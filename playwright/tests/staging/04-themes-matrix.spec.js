/**
 * 04 — Theme matrix.
 *
 * BetterDocs renders differently depending on theme classification:
 *   - FSE themes (TT2024, TT2025, TT2026) — block-themes path
 *   - Hello Elementor — theme-builder path (Elementor templates)
 *   - Legacy customizer themes (Astra, Storefront, classic TT2021) — customizer path
 *
 * For each theme we switch to via wp-admin themes screen, load /docs/ as guest,
 * and screenshot. If theme isn't installed, log and skip.
 */
const { test, expect } = require("@playwright/test");
const { gotoAdmin, loginAsAdmin } = require("../../helpers/staging/auth");
const { logRename } = require("../../helpers/staging/settings");
const { newGuestPage, visitFrontend } = require("../../helpers/staging/frontend");
const { shoot } = require("../../helpers/staging/screenshot");
const THEMES = [
    { slug: 'twentytwentyfour', label: 'Twenty Twenty-Four', kind: 'fse' },
    { slug: 'twentytwentyfive', label: 'Twenty Twenty-Five', kind: 'fse' },
    { slug: 'hello-elementor', label: 'Hello Elementor', kind: 'theme-builder' },
    { slug: 'twentytwentyone', label: 'Twenty Twenty-One', kind: 'legacy' },
    { slug: 'astra', label: 'Astra', kind: 'legacy' },
];
/**
 * Find a theme on the themes screen.
 * Activate via REST so we don't fight Playwright's lazy theme grid.
 */
async function activateTheme(page, slug) {
    await gotoAdmin(page, 'themes.php');
    await page.waitForTimeout(1500);
    const themeRow = page.locator(`div.theme[data-slug="${slug}"]`);
    if (await themeRow.count() === 0) {
        return false; // not installed
    }
    if (await themeRow.first().evaluate((el) => el.classList.contains('active'))) {
        return true; // already active
    }
    // Hover to expose the Activate button
    await themeRow.first().hover();
    const activate = themeRow.locator('a:has-text("Activate")');
    if (await activate.count() === 0)
        return false;
    await Promise.all([
        page.waitForLoadState('domcontentloaded'),
        activate.first().click(),
    ]);
    await page.waitForTimeout(2500);
    return true;
}
test.describe.serial('04 · Theme matrix', () => {
    for (const theme of THEMES) {
        test(`04.${theme.kind}-${theme.slug} — frontend /docs/ under ${theme.label}`, async ({ page, browser }) => {
            await loginAsAdmin(page);
            const activated = await activateTheme(page, theme.slug);
            if (!activated) {
                logRename('theme', theme.label, '(not installed)');
                return;
                return;
            }
            await shoot(page, 'test-results-staging/04-themes/active-${theme.slug}.png');
            const { page: guest, ctx } = await newGuestPage(browser);
            await visitFrontend(guest, '/docs/');
            await guest.waitForTimeout(2500);
            const body = await guest.locator('body').textContent() || '';
            expect(body, `${theme.label} frontend should not fatal`).not.toMatch(/Fatal error|Uncaught/);
            await shoot(guest, 'test-results-staging/04-themes/frontend-${theme.slug}.png', { fullPage: true });
            await ctx.close();
        });
    }
});

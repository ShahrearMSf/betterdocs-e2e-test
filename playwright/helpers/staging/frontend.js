/**
 * Frontend verification helpers — visit a public URL as a guest and confirm
 * something rendered. Uses a separate browser context so the admin cookies
 * don't leak into "guest" tests.
 */
const { expect } = require("@playwright/test");
const { STAGING } = require("./env");
async function newGuestPage(browser) {
    // Explicit storageState: undefined — Playwright's project-level
    // `use.storageState` (the admin cookie file we persist per run) would
    // otherwise leak into this new context. Then the "guest" is really an
    // admin, and negative-path tests (e.g. "guest can't reach wp-admin")
    // silently pass their permission checks and then fail the assertion.
    const ctx = await browser.newContext({ storageState: undefined });
    const page = await ctx.newPage();
    return { page, ctx };
}
async function visitFrontend(page, path) {
    const url = path.startsWith('http') ? path : `${STAGING.url}/${path.replace(/^\//, '')}`;
    // Retry transient network hiccups against the live staging site (ERR_NETWORK_CHANGED, etc.)
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            await page.waitForTimeout(900);
            return;
        }
        catch (e) {
            lastErr = e;
            await page.waitForTimeout(2000 * attempt);
        }
    }
    throw lastErr;
}
/**
 * Lightweight "did it render?" check — page didn't 500, didn't 404, has body content.
 */
async function expectPageOk(page) {
    const body = await page.locator('body').textContent() || '';
    expect(body, 'page should not be a fatal-error page').not.toMatch(/Fatal error|Uncaught Error/);
    expect(body, 'page should not be 404').not.toMatch(/Page not found/);
}
/**
 * Verify a CSS-selector / text combo is on the page (with retry).
 */
async function expectSelector(page, sel, label = '') {
    const el = page.locator(sel);
    await expect(el.first(), `expected ${label || sel} to be visible`).toBeVisible({ timeout: 8_000 });
}

module.exports = { newGuestPage, visitFrontend, expectPageOk, expectSelector };

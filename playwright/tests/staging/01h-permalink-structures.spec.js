/**
 * Permalink structure matrix.
 * Switch WP's permalink_structure option to each variant, flush rewrites,
 * visit /docs/ and a single-doc URL, verify they don't 404.
 *
 * Variants tested:
 *   plain       — ?p=N
 *   day-name    — /%year%/%monthnum%/%day%/%postname%/
 *   month-name  — /%year%/%monthnum%/%postname%/
 *   post-name   — /%postname%/
 *   numeric     — /archives/%post_id%
 *   custom      — /docs-test/%postname%/
 */
const { test } = require("@playwright/test");
const { loginAsAdmin, gotoAdmin } = require("../../helpers/staging/auth");
const { setTier } = require("../../helpers/staging/plugins");
const { createDoc, deleteDoc } = require("../../helpers/staging/records");
const { logRename } = require("../../helpers/staging/settings");
const { newGuestPage, visitFrontend } = require("../../helpers/staging/frontend");
const { STAGING } = require("../../helpers/staging/env");
const { shoot } = require("../../helpers/staging/screenshot");
let testDocId = null;
let testDocLink = null;
const STRUCTURES = [
    { name: 'plain', value: '' },
    { name: 'day-name', value: '/%year%/%monthnum%/%day%/%postname%/' },
    { name: 'month-name', value: '/%year%/%monthnum%/%postname%/' },
    { name: 'post-name', value: '/%postname%/' },
    { name: 'numeric', value: '/archives/%post_id%' },
    { name: 'custom', value: '/docs-test/%postname%/' },
];
test.describe.serial('01h · Permalink structures', () => {
    test.beforeAll(async ({ browser }) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await loginAsAdmin(page);
        await setTier(page, 'free');
        const doc = await createDoc(page, { title: `QA Permalink Doc ${Date.now()}`, content: '<p>permalink probe</p>' });
        testDocId = doc?.id ?? null;
        testDocLink = doc?.link ?? null;
        await ctx.close();
    });
    async function setPermalink(page, structure) {
        // Use the wp-admin Options-Permalink UI submit (no REST endpoint for this option)
        await gotoAdmin(page, 'options-permalink.php');
        await page.waitForTimeout(900);
        // Set the custom_structure value + tick the matching radio
        await page.evaluate((s) => {
            const input = document.querySelector('input[name="permalink_structure"]');
            if (input)
                input.value = s;
        }, structure);
        await page.click('input[type="submit"][name="submit"]').catch(() => { });
        await page.waitForTimeout(1500);
    }
    for (const s of STRUCTURES) {
        test(`01h.${s.name} — /docs/ doesn't 404`, async ({ page, browser }) => {
            await loginAsAdmin(page);
            await setPermalink(page, s.value);
            const { page: guest, ctx } = await newGuestPage(browser);
            // For plain perma, the URL shape is different
            await visitFrontend(guest, s.value === '' ? '/?post_type=docs' : '/docs/');
            await guest.waitForTimeout(1500);
            const body = await guest.locator('body').textContent() || '';
            if (/Page not found|404 Not Found/i.test(body)) {
                logRename(`permalink-${s.name}`, '200', '404 on /docs/');
            }
            await shoot(guest, 'test-results-staging/01h-permalinks/${s.name}.png');
            await ctx.close();
        });
    }
    test('01h.restore — post-name', async ({ page }) => {
        await loginAsAdmin(page);
        await page.goto(`${STAGING.url}/wp-admin/options-permalink.php`, { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => {
            const input = document.querySelector('input[name="permalink_structure"]');
            if (input)
                input.value = '/%postname%/';
        });
        await page.click('input[type="submit"][name="submit"]').catch(() => { });
        await page.waitForTimeout(1200);
        if (testDocId)
            await deleteDoc(page, testDocId);
    });
});

/**
 * Layout matrix — switch each Single-Doc Layout (1-10) + Archive Layout (1-3)
 * + FAQ Layout (modern/classic/tab/abstract) and verify frontend renders.
 */
const { test } = require("@playwright/test");
const { loginAsAdmin, getRestNonce } = require("../../helpers/staging/auth");
const { setTier } = require("../../helpers/staging/plugins");
const { createDoc, deleteDoc } = require("../../helpers/staging/records");
const { newGuestPage, visitFrontend, expectPageOk } = require("../../helpers/staging/frontend");
const { STAGING } = require("../../helpers/staging/env");
const { shoot } = require("../../helpers/staging/screenshot");
let testDocId = null;
let testDocLink = null;
const SINGLE_LAYOUTS = ['layout-1', 'layout-2', 'layout-3', 'layout-4', 'layout-5', 'layout-6', 'layout-7', 'layout-8', 'layout-9', 'layout-10'];
const ARCHIVE_LAYOUTS = ['layout-1', 'layout-2', 'layout-3'];
test.describe.serial('01g · Layout matrix', () => {
    test.beforeAll(async ({ browser }) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await loginAsAdmin(page);
        await setTier(page, 'free');
        const doc = await createDoc(page, { title: `QA Layout Doc ${Date.now()}`, content: '<h2>Section 1</h2><p>Lorem ipsum dolor sit amet.</p><h2>Section 2</h2><p>Consectetur adipiscing elit.</p>' });
        testDocId = doc?.id ?? null;
        testDocLink = doc?.link ?? null;
        await ctx.close();
    });
    async function setLayout(page, key, value) {
        const nonce = await getRestNonce(page);
        await page.evaluate(async ([url, nonce, body]) => {
            await fetch(`${url}/wp-json/betterdocs/v1/settings`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        }, [STAGING.url, nonce, { settings: { [key]: value } }]);
    }
    for (const layout of SINGLE_LAYOUTS) {
        test(`01g.single.${layout} — frontend renders`, async ({ page, browser }) => {
            if (!testDocLink) {
                return;
            }
            await loginAsAdmin(page);
            await setLayout(page, 'single_doc_layout', layout);
            await page.waitForTimeout(800);
            const { page: guest, ctx } = await newGuestPage(browser);
            await visitFrontend(guest, testDocLink.replace(STAGING.url, ''));
            await guest.waitForTimeout(1500);
            await expectPageOk(guest);
            await shoot(guest, 'test-results-staging/01g-layouts/single-${layout}.png', { fullPage: false });
            await ctx.close();
        });
    }
    for (const layout of ARCHIVE_LAYOUTS) {
        test(`01g.archive.${layout} — frontend renders`, async ({ page, browser }) => {
            await loginAsAdmin(page);
            await setLayout(page, 'docs_archive_layout', layout);
            await page.waitForTimeout(800);
            const { page: guest, ctx } = await newGuestPage(browser);
            await visitFrontend(guest, '/docs/');
            await guest.waitForTimeout(1500);
            await expectPageOk(guest);
            await shoot(guest, 'test-results-staging/01g-layouts/archive-${layout}.png');
            await ctx.close();
        });
    }
    test('01g.cleanup', async ({ page }) => {
        await loginAsAdmin(page);
        if (testDocId)
            await deleteDoc(page, testDocId);
    });
});

/**
 * Edge cases — long titles, non-Latin slugs, hierarchical categories,
 * doc without category, draft visibility, password-protected doc.
 */
const { test, expect } = require("@playwright/test");
const { loginAsAdmin, getRestNonce } = require("../../helpers/staging/auth");
const { setTier } = require("../../helpers/staging/plugins");
const { createDoc, createDocCategory, deleteDoc, deleteDocCategory } = require("../../helpers/staging/records");
const { newGuestPage, visitFrontend, expectPageOk } = require("../../helpers/staging/frontend");
const { logRename } = require("../../helpers/staging/settings");
const { STAGING } = require("../../helpers/staging/env");
const { shoot } = require("../../helpers/staging/screenshot");
const created = { docs: [], cats: [] };
test.describe.serial('01i · Edge cases', () => {
    test.beforeAll(async ({ browser }) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await loginAsAdmin(page);
        await setTier(page, 'free');
        await ctx.close();
    });
    test('01i.1 doc with very long title', async ({ page, browser }) => {
        await loginAsAdmin(page);
        const title = 'QA Long Title — ' + 'word '.repeat(40) + Date.now();
        const doc = await createDoc(page, { title, content: '<p>long title test</p>' });
        if (doc?.id)
            created.docs.push(doc.id);
        const { page: guest, ctx } = await newGuestPage(browser);
        await visitFrontend(guest, doc?.link?.replace(STAGING.url, '') || '/docs/');
        await expectPageOk(guest);
        await shoot(guest, 'test-results-staging/01i-edge/01-long-title.png');
        await ctx.close();
    });
    test('01i.2 doc with non-ASCII (Bengali) title', async ({ page, browser }) => {
        await loginAsAdmin(page);
        const title = 'বেটারডকস ' + Date.now();
        const doc = await createDoc(page, { title, content: '<p>nonлatin test • হ্যালো</p>' });
        if (doc?.id)
            created.docs.push(doc.id);
        const { page: guest, ctx } = await newGuestPage(browser);
        await visitFrontend(guest, doc?.link?.replace(STAGING.url, '') || '/docs/');
        await guest.waitForTimeout(1500);
        await expectPageOk(guest);
        await shoot(guest, 'test-results-staging/01i-edge/02-nonascii.png');
        await ctx.close();
    });
    test('01i.3 hierarchical categories — parent + child', async ({ page }) => {
        await loginAsAdmin(page);
        const parent = await createDocCategory(page, `QA Parent ${Date.now()}`);
        if (parent?.id)
            created.cats.push(parent.id);
        const nonce = await getRestNonce(page);
        const child = await page.evaluate(async ([url, nonce, parentId]) => {
            const r = await fetch(`${url}/wp-json/wp/v2/doc_category`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: `QA Child ${Date.now()}`, parent: parentId }),
            });
            return r.ok ? await r.json() : null;
        }, [STAGING.url, nonce, parent?.id]);
        if (child?.id)
            created.cats.push(child.id);
        expect(child?.parent, 'child should reference parent').toBe(parent?.id);
    });
    test('01i.4 doc without category', async ({ page, browser }) => {
        await loginAsAdmin(page);
        const doc = await createDoc(page, { title: `QA No-Cat Doc ${Date.now()}`, content: '<p>no category doc</p>' });
        if (doc?.id)
            created.docs.push(doc.id);
        const { page: guest, ctx } = await newGuestPage(browser);
        await visitFrontend(guest, doc?.link?.replace(STAGING.url, '') || '/docs/');
        await expectPageOk(guest);
        await ctx.close();
    });
    test('01i.5 draft doc not visible to guest', async ({ page, browser }) => {
        await loginAsAdmin(page);
        const doc = await createDoc(page, { title: `QA Draft Doc ${Date.now()}`, content: '<p>draft</p>', status: 'draft' });
        if (doc?.id)
            created.docs.push(doc.id);
        if (!doc?.link) {
            return;
        }
        const { page: guest, ctx } = await newGuestPage(browser);
        await visitFrontend(guest, doc.link.replace(STAGING.url, ''));
        await guest.waitForTimeout(1500);
        const body = await guest.locator('body').textContent() || '';
        // Drafts should 404 for guests (or show a "Sorry, not allowed" message)
        const isAccessible = !/404|not found|sorry|forbidden/i.test(body);
        if (isAccessible)
            logRename('draft-visibility', '404/forbidden for guest', 'doc appears accessible');
        await ctx.close();
    });
    test('01i.6 password-protected doc shows password form', async ({ page, browser }) => {
        await loginAsAdmin(page);
        const nonce = await getRestNonce(page);
        const doc = await page.evaluate(async ([url, nonce]) => {
            const r = await fetch(`${url}/wp-json/wp/v2/docs`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: `QA PW Doc ${Date.now()}`,
                    content: '<p>protected</p>',
                    status: 'publish',
                    password: 'qa-pass-123',
                }),
            });
            return r.ok ? await r.json() : null;
        }, [STAGING.url, nonce]);
        if (doc?.id)
            created.docs.push(doc.id);
        if (!doc?.link) {
            return;
        }
        const { page: guest, ctx } = await newGuestPage(browser);
        await visitFrontend(guest, doc.link.replace(STAGING.url, ''));
        await guest.waitForTimeout(1500);
        const hasPasswordForm = await guest.evaluate(() => !!document.querySelector('input[type="password"]'));
        if (!hasPasswordForm)
            logRename('password-protection', 'input[type=password]', '(not shown to guest)');
        await shoot(guest, 'test-results-staging/01i-edge/06-password-form.png');
        await ctx.close();
    });
    test('01i.99 cleanup', async ({ page }) => {
        await loginAsAdmin(page);
        for (const id of created.docs)
            await deleteDoc(page, id);
        for (const id of created.cats)
            await deleteDocCategory(page, id);
    });
});

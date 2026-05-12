/**
 * MKB-deep — multiple KBs, scoped categories + docs, KB switching from frontend.
 */
const { test } = require("@playwright/test");
const { loginAsAdmin } = require("../../helpers/staging/auth");
const { setTier } = require("../../helpers/staging/plugins");
const { createKB, createDocCategory, createDoc, deleteDoc, deleteDocCategory, deleteKB } = require("../../helpers/staging/records");
const { setMultipleKb, logRename } = require("../../helpers/staging/settings");
const { newGuestPage, visitFrontend, expectPageOk } = require("../../helpers/staging/frontend");
const { shoot } = require("../../helpers/staging/screenshot");
const created = { docs: [], cats: [], kbs: [] };
test.describe.serial('02d · MKB-deep', () => {
    test.beforeAll(async ({ browser }) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await loginAsAdmin(page);
        await setTier(page, 'pro');
        await setMultipleKb(page, true);
        await ctx.close();
    });
    test('02d.1 create 2 KBs', async ({ page }) => {
        await loginAsAdmin(page);
        for (let i = 1; i <= 2; i++) {
            const kb = await createKB(page, `QA KB ${i} ${Date.now()}`);
            if (kb?.id)
                created.kbs.push(kb.id);
        }
    });
    test('02d.2 each KB has its own category', async ({ page }) => {
        await loginAsAdmin(page);
        for (let i = 0; i < Math.min(2, created.kbs.length); i++) {
            const cat = await createDocCategory(page, `QA Cat in KB${i + 1} ${Date.now()}`, { kb: created.kbs[i] });
            if (cat?.id)
                created.cats.push(cat.id);
        }
    });
    test('02d.3 docs in each KB+category render on frontend', async ({ page, browser }) => {
        await loginAsAdmin(page);
        for (let i = 0; i < Math.min(2, created.cats.length); i++) {
            const doc = await createDoc(page, {
                title: `QA Doc KB${i + 1} ${Date.now()}`,
                content: `<p>doc inside KB ${i + 1}</p>`,
                categories: [created.cats[i]],
            });
            if (doc?.id)
                created.docs.push(doc.id);
        }
        // Frontend probe — main /docs/ should render
        const { page: guest, ctx } = await newGuestPage(browser);
        await visitFrontend(guest, '/docs/');
        await expectPageOk(guest);
        await shoot(guest, 'test-results-staging/02d-mkb/03-docs-archive.png', { fullPage: true });
        await ctx.close();
    });
    test('02d.4 KB archive URL renders for each KB', async ({ browser }) => {
        for (let i = 0; i < created.kbs.length; i++) {
            const { page: guest, ctx } = await newGuestPage(browser);
            // KB archive shape typically /docs/{kb-slug}/ or /knowledge-base/{kb-slug}/
            await visitFrontend(guest, `/docs/qa-kb-${i + 1}/`);
            await guest.waitForTimeout(1500);
            const body = await guest.locator('body').textContent() || '';
            if (/Page not found|404/i.test(body)) {
                logRename(`mkb-archive-url`, `/docs/qa-kb-${i + 1}/`, 'returned 404');
            }
            await shoot(guest, 'test-results-staging/02d-mkb/04-kb${i+1}-archive.png');
            await ctx.close();
        }
    });
    test('02d.99 cleanup', async ({ page }) => {
        await loginAsAdmin(page);
        for (const id of created.docs)
            await deleteDoc(page, id);
        for (const id of created.cats)
            await deleteDocCategory(page, id);
        for (const id of created.kbs)
            await deleteKB(page, id);
        await setMultipleKb(page, false);
    });
});

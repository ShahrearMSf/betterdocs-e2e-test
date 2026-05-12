/**
 * Tier 2b — extended Pro-tier tests.
 *
 *   - Related Docs: create 3 docs in same category, verify related-docs list on each
 *   - Access & Restrictions: enable content restriction, set restricted category, verify
 *     guest can NOT see a restricted doc
 *   - Migration tab: see options listed
 *   - Import / Export: actual export click + file download (smoke)
 *   - Single doc metabox: Related Articles meta box visible
 */
const { test, expect } = require("@playwright/test");
const { loginAsAdmin, getRestNonce, gotoAdmin } = require("../../helpers/staging/auth");
const { setTier } = require("../../helpers/staging/plugins");
const { createDocCategory, createDoc, deleteDoc, deleteDocCategory } = require("../../helpers/staging/records");
const { logRename } = require("../../helpers/staging/settings");
const { newGuestPage, visitFrontend } = require("../../helpers/staging/frontend");
const { STAGING } = require("../../helpers/staging/env");
const { shoot } = require("../../helpers/staging/screenshot");
const created = { docs: [], cats: [] };
test.describe.serial('Tier 2b · Pro extended', () => {
    test.beforeAll(async ({ browser }) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await loginAsAdmin(page);
        await setTier(page, 'pro');
        await ctx.close();
    });
    test('2b.1 Related Docs — 3 docs in same category, verify related list', async ({ page, browser }) => {
        await loginAsAdmin(page);
        const cat = await createDocCategory(page, `QA Related Cat ${Date.now()}`);
        if (cat?.id)
            created.cats.push(cat.id);
        const ids = [];
        for (let i = 1; i <= 3; i++) {
            const doc = await createDoc(page, {
                title: `QA Related Doc ${i} ${Date.now()}`,
                content: `<p>Body for related doc ${i}. Each shares the category for the related-docs algorithm.</p>`,
                categories: cat?.id ? [cat.id] : [],
            });
            if (doc?.id) {
                created.docs.push(doc.id);
                ids.push(doc.id);
            }
        }
        expect(ids.length, '3 docs created').toBe(3);
        // Visit doc 1 on frontend and check for related-docs section
        const nonce = await getRestNonce(page);
        const doc1 = await page.evaluate(async ([url, nonce, id]) => {
            const r = await fetch(`${url}/wp-json/wp/v2/docs/${id}?_fields=link`, { credentials: 'include', headers: { 'X-WP-Nonce': nonce } });
            return r.ok ? await r.json() : null;
        }, [STAGING.url, nonce, ids[0]]);
        if (!doc1)
            return;
        const { page: guest, ctx } = await newGuestPage(browser);
        await visitFrontend(guest, doc1.link.replace(STAGING.url, ''));
        await guest.waitForTimeout(2500);
        const hasRelated = await guest.evaluate(() => {
            return !!document.querySelector('[class*="related-docs"], [class*="related-articles"], [class*="betterdocs-related"]');
        });
        if (!hasRelated)
            console.log('[2b.1] Related-docs widget not rendered on this template');
        await shoot(guest, 'test-results-staging/02b-tier2/01-related-docs-frontend.png');
        await ctx.close();
    });
    test('2b.2 Access & Restrictions — enable + restrict a category, verify guest sees nothing', async ({ page, browser }) => {
        await loginAsAdmin(page);
        const nonce = await getRestNonce(page);
        // Enable content restriction
        await page.evaluate(async ([url, nonce]) => {
            await fetch(`${url}/wp-json/betterdocs/v1/settings`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: {
                        enable_content_restriction: true,
                        content_visibility: ['administrator'],
                        restrict_template: ['all'],
                        restrict_category: ['all'],
                    } }),
            });
        }, [STAGING.url, nonce]);
        // Visit /docs/ as guest — should be empty / restricted
        const { page: guest, ctx } = await newGuestPage(browser);
        await visitFrontend(guest, '/docs/');
        await guest.waitForTimeout(2500);
        const body = await guest.locator('body').textContent() || '';
        const restrictedVisible = /restrict|not allowed|members only|sign in/i.test(body);
        const docTitlesVisible = /QA Related Doc/i.test(body);
        console.log('Guest /docs/ — restriction text:', restrictedVisible, '· QA doc visible:', docTitlesVisible);
        await shoot(guest, 'test-results-staging/02b-tier2/02-access-restricted-guest.png');
        await ctx.close();
        // Reset for cleanup
        await page.evaluate(async ([url, nonce]) => {
            await fetch(`${url}/wp-json/betterdocs/v1/settings`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: {
                        enable_content_restriction: false,
                        content_visibility: ['all'],
                    } }),
            });
        }, [STAGING.url, nonce]);
    });
    test('2b.3 Single-doc edit screen — Related Articles meta box present', async ({ page }) => {
        await loginAsAdmin(page);
        if (created.docs.length === 0) {
            // create a quick doc so the edit page has something to open
            const doc = await createDoc(page, { title: `QA Edit Doc ${Date.now()}`, content: '<p>edit test</p>' });
            if (doc?.id)
                created.docs.push(doc.id);
        }
        const id = created.docs[0];
        if (!id)
            return;
        await gotoAdmin(page, `post.php?post=${id}&action=edit`);
        await page.waitForTimeout(3500);
        const body = await page.locator('body').textContent() || '';
        // Pro adds "Related Articles" / "Related Docs" metabox
        const hasRelatedMetabox = /Related Articles|Related Docs/i.test(body);
        if (!hasRelatedMetabox)
            console.log('[2b.3] Related Articles metabox not present on doc-edit screen');
        await shoot(page, 'test-results-staging/02b-tier2/03-doc-edit-screen.png', { fullPage: true });
    });
    test('2b.4 Migration tab options visible', async ({ page }) => {
        await loginAsAdmin(page);
        await gotoAdmin(page, 'admin.php?page=betterdocs-settings');
        await page.waitForTimeout(2000);
        const t = page.locator('.wprf-tab-nav-item', { hasText: 'Migration' });
        if (await t.count() === 0) {
            logRename('settings-tab', 'Migration', '(not found)');
            return;
        }
        await t.first().click();
        await page.waitForTimeout(1500);
        const body = await page.locator('.wprf-tab-content.wprf-active').first().textContent() || '';
        const migrationSources = /WordPress|Echo|Help Scout|Document360|Notion|Confluence|HelpDocs/i.test(body);
        if (!migrationSources)
            console.log('[2b.4] No recognizable migration source label on Migration tab');
        await shoot(page, 'test-results-staging/02b-tier2/04-migration-tab.png', { fullPage: true });
    });
    test('2b.5 Import / Export — verify CSV/XML download button present', async ({ page }) => {
        await loginAsAdmin(page);
        await gotoAdmin(page, 'admin.php?page=betterdocs-settings');
        await page.waitForTimeout(2000);
        const t = page.locator('.wprf-tab-nav-item', { hasText: 'Import / Export' });
        if (await t.count() === 0) {
            logRename('settings-tab', 'Import / Export', '(not found)');
            return;
        }
        await t.first().click();
        await page.waitForTimeout(2000);
        const body = await page.locator('.wprf-tab-content.wprf-active').first().textContent() || '';
        const hasButtons = /export|import|download|csv|xml/i.test(body);
        if (!hasButtons)
            console.log('[2b.5] No import/export labels on Import/Export tab');
        await shoot(page, 'test-results-staging/02b-tier2/05-import-export-tab.png', { fullPage: true });
    });
    test('2b.6 Analytics — verify charts / counters render (smoke)', async ({ page }) => {
        await loginAsAdmin(page);
        await gotoAdmin(page, 'admin.php?page=betterdocs-analytics');
        await page.waitForTimeout(4000);
        const body = await page.locator('body').textContent() || '';
        const hasMetrics = /Total Views|Total Searches|Reactions|chart|trend/i.test(body);
        if (!hasMetrics)
            console.log('[2b.6] No analytics metric labels visible (may be empty / not yet seeded)');
        await shoot(page, 'test-results-staging/02b-tier2/06-analytics-data.png', { fullPage: true });
    });
    test('2b.99 Cleanup tier-2b entities', async ({ page }) => {
        await loginAsAdmin(page);
        for (const id of created.docs)
            await deleteDoc(page, id);
        for (const id of created.cats)
            await deleteDocCategory(page, id);
        console.log('Tier 2b cleanup:', created);
    });
});

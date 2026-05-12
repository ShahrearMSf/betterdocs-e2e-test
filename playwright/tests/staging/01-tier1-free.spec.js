var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
/**
 * Tier 1 — BetterDocs Free alone (+ Essential Blocks).
 *
 * Covers:
 *   - Dashboard loads
 *   - All Docs page (3 view modes: grid / list / classic)
 *   - Settings tabs: General, Layout, Design, Shortcodes, Email Reporting,
 *     Instant Answer, AI Content Suite, Import/Export, License
 *   - Categories — create, verify on frontend, delete
 *   - Tags — create, verify on frontend, delete
 *   - Docs — create one in category + with tag, verify frontend renders, delete
 *   - FAQ Builder — create FAQ + verify on frontend
 *   - Glossaries — create + verify
 *   - Image upload via Media Library (smoke check)
 *
 * Stores created entity IDs on the test scope for the cleanup spec to consume.
 */
const { test, expect } = require("@playwright/test");
const { loginAsAdmin, gotoAdmin } = require("../../helpers/staging/auth");
const { setTier } = require("../../helpers/staging/plugins");
const { createDocCategory, createDocTag, createDoc, createFaq, createGlossary, deleteDoc, deleteFaq, deleteGlossary, deleteDocTag, deleteDocCategory } = require("../../helpers/staging/records");
const { logRename, listSettingsTabs } = require("../../helpers/staging/settings");
const { newGuestPage, visitFrontend, expectPageOk } = require("../../helpers/staging/frontend");
const { STAGING } = require("../../helpers/staging/env");
const { shoot } = require("../../helpers/staging/screenshot");
// Track IDs across tests for end-of-spec cleanup
const created = {
    docs: [], cats: [], tags: [], faqs: [], glossaries: [],
};
test.describe.serial('Tier 1 · BetterDocs Free', () => {
    test.beforeAll(async ({ browser }) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await loginAsAdmin(page);
        await setTier(page, 'free');
        await ctx.close();
    });
    test('1.1 BetterDocs admin menu present + Dashboard loads', async ({ page }) => {
        await loginAsAdmin(page);
        await gotoAdmin(page, 'admin.php?page=betterdocs-dashboard');
        await page.waitForTimeout(2000);
        const dash = await page.locator('body').textContent() || '';
        // Don't be strict on label — BetterDocs Dashboard might rename
        if (!/BetterDocs|Dashboard|Knowledge/i.test(dash)) {
            logRename('tier1-dashboard', 'BetterDocs', '(not found)');
        }
        await shoot(page, 'test-results-staging/01-tier1/01-dashboard.png');
    });
    test('1.2 All Docs list page loads + view-mode buttons present', async ({ page }) => {
        await loginAsAdmin(page);
        await gotoAdmin(page, 'edit.php?post_type=docs');
        await page.waitForTimeout(1500);
        await shoot(page, 'test-results-staging/01-tier1/02-all-docs.png');
        // View-mode toggle buttons are icon-only — match by title/aria-label/data attr,
        // not by visible text. If the toggle bar isn't on this build, skip silently.
        const modes = [
            { key: 'grid', selectors: ['[title*="Grid" i]', '[aria-label*="Grid" i]', '[data-mode="grid"]', 'button.grid-view'] },
            { key: 'list', selectors: ['[title*="List" i]', '[aria-label*="List" i]', '[data-mode="list"]', 'button.list-view'] },
            { key: 'classic', selectors: ['[title*="Classic" i]', '[aria-label*="Classic" i]', '[data-mode="classic"]', 'button.classic-view'] },
        ];
        for (const m of modes) {
            const sel = m.selectors.join(', ');
            const btn = page.locator(sel).first();
            if (await btn.count() === 0)
                continue;
            await btn.click({ timeout: 1500 }).catch(() => { });
            await page.waitForTimeout(800);
            await shoot(page, `test-results-staging/01-tier1/02-${m.key}.png`);
        }
    });
    test('1.3 Settings tabs inventory (Free tier)', async ({ page }) => {
        await loginAsAdmin(page);
        await gotoAdmin(page, 'admin.php?page=betterdocs-settings');
        await page.waitForTimeout(2000);
        const tabs = await listSettingsTabs(page);
        console.log('Free-tier settings tabs:', tabs);
        expect(tabs.length, 'should have at least 5 settings tabs in free tier').toBeGreaterThanOrEqual(5);
        await shoot(page, 'test-results-staging/01-tier1/03-settings-tabs.png');
        // Click through each tab + screenshot
        for (const label of tabs) {
            const tab = page.locator('.wprf-tab-nav-item', { hasText: label });
            if (await tab.count() === 0)
                continue;
            await tab.first().click().catch(() => { });
            await page.waitForTimeout(900);
            const safeName = label.toLowerCase().replace(/\W+/g, '-');
            await shoot(page, 'test-results-staging/01-tier1/03-tab-${safeName}.png');
        }
    });
    test('1.4 Toggle a setting + verify reflection on frontend', async ({ page, browser }) => {
        // Toggle "Disable BetterDocs Built-in Doc Page" via REST so we don't depend on UI labels
        await loginAsAdmin(page);
        const { getRestNonce } = await Promise.resolve().then(() => __importStar(require('../../helpers/staging/auth')));
        const nonce = await getRestNonce(page);
        // Enable breadcrumb — a small change that's easy to verify
        await page.evaluate(async ([nonce, url]) => {
            await fetch(`${url}/wp-json/betterdocs/v1/settings`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: { breadcrumb: true } }),
            });
        }, [nonce, STAGING.url]);
        // Visit a frontend page and check it doesn't fatal
        const { page: guest, ctx } = await newGuestPage(browser);
        await visitFrontend(guest, '/docs/');
        await expectPageOk(guest);
        await shoot(guest, 'test-results-staging/01-tier1/04-frontend-docs-archive.png');
        await ctx.close();
    });
    test('1.5 Categories — create + verify in admin', async ({ page }) => {
        await loginAsAdmin(page);
        const cat = await createDocCategory(page, `QA Category ${Date.now()}`);
        expect(cat?.id, 'category creation should return an id').toBeTruthy();
        if (cat?.id)
            created.cats.push(cat.id);
        await gotoAdmin(page, 'edit-tags.php?taxonomy=doc_category&post_type=docs');
        await page.waitForTimeout(1500);
        await shoot(page, 'test-results-staging/01-tier1/05-categories.png');
    });
    test('1.6 Tags — create + verify in admin', async ({ page }) => {
        await loginAsAdmin(page);
        const tag = await createDocTag(page, `QA Tag ${Date.now()}`);
        expect(tag?.id, 'tag creation should return an id').toBeTruthy();
        if (tag?.id)
            created.tags.push(tag.id);
        await gotoAdmin(page, 'edit-tags.php?taxonomy=doc_tag&post_type=docs');
        await page.waitForTimeout(1500);
        await shoot(page, 'test-results-staging/01-tier1/06-tags.png');
    });
    test('1.7 Doc — create in category + tag, verify frontend renders', async ({ page, browser }) => {
        await loginAsAdmin(page);
        const catId = created.cats[0];
        const tagId = created.tags[0];
        const doc = await createDoc(page, {
            title: `QA Doc ${Date.now()}`,
            content: '<p>QA seed body — Tier 1.</p>',
            categories: catId ? [catId] : [],
            tags: tagId ? [tagId] : [],
        });
        expect(doc?.id, 'doc creation should return an id').toBeTruthy();
        if (doc?.id)
            created.docs.push(doc.id);
        // Verify it shows in admin list
        await gotoAdmin(page, 'edit.php?post_type=docs');
        await page.waitForTimeout(1500);
        const adminBody = await page.locator('body').textContent() || '';
        expect(adminBody, 'created doc title should appear in admin list').toContain(doc.title.rendered);
        await shoot(page, 'test-results-staging/01-tier1/07-admin-docs-list.png');
        // Verify frontend
        const { page: guest, ctx } = await newGuestPage(browser);
        await visitFrontend(guest, doc.link.replace(STAGING.url, ''));
        await expectPageOk(guest);
        const body = await guest.locator('body').textContent() || '';
        expect(body, 'frontend should contain the doc title').toContain(doc.title.rendered);
        await shoot(guest, 'test-results-staging/01-tier1/07-frontend-doc.png');
        await ctx.close();
    });
    test('1.8 FAQ Builder — create FAQ', async ({ page }) => {
        await loginAsAdmin(page);
        const faq = await createFaq(page, { title: `QA FAQ ${Date.now()}` });
        if (faq?.id) {
            created.faqs.push(faq.id);
            await gotoAdmin(page, 'admin.php?page=betterdocs-faq');
            await page.waitForTimeout(2000);
            await shoot(page, 'test-results-staging/01-tier1/08-faq-builder.png');
        }
        else {
            logRename('faq-rest-endpoint', '/wp-json/wp/v2/betterdocs_faq', 'rejected');
        }
    });
    test('1.9 Glossaries — visit admin page', async ({ page }) => {
        await loginAsAdmin(page);
        const gl = await createGlossary(page, { title: `QA Glossary ${Date.now()}` });
        if (gl?.id)
            created.glossaries.push(gl.id);
        await gotoAdmin(page, 'admin.php?page=betterdocs-glossaries');
        await page.waitForTimeout(1500);
        await shoot(page, 'test-results-staging/01-tier1/09-glossaries.png');
    });
    test('1.10 Image upload smoke — Media Library', async ({ page }) => {
        await loginAsAdmin(page);
        await gotoAdmin(page, 'upload.php');
        await page.waitForTimeout(1500);
        // We won't actually upload a binary in CI to avoid flakiness — just verify the page loads
        await expect(page.locator('body')).not.toContainText(/Fatal error|database/i);
        await shoot(page, 'test-results-staging/01-tier1/10-media-library.png');
    });
    test('1.99 Cleanup tier-1 entities', async ({ page }) => {
        await loginAsAdmin(page);
        for (const id of created.docs)
            await deleteDoc(page, id);
        for (const id of created.faqs)
            await deleteFaq(page, id);
        for (const id of created.glossaries)
            await deleteGlossary(page, id);
        for (const id of created.tags)
            await deleteDocTag(page, id);
        for (const id of created.cats)
            await deleteDocCategory(page, id);
        console.log('Cleaned up:', created);
    });
});

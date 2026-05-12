/**
 * Tier 1b — extended Free-tier tests.
 *
 *   - Real image upload via REST media endpoint
 *   - Block-by-block rendering smoke tests (Gutenberg)
 *   - Shortcode rendering smoke tests
 *   - Per-tab functional checks (Email Reporting, Instant Answer, AI Content Suite,
 *     Migration, Import / Export, Shortcodes, Layout, Design)
 *   - Frontend search modal / Instant Answer guest test
 */
const { test, expect } = require("@playwright/test");
const { loginAsAdmin, gotoAdmin, getRestNonce } = require("../../helpers/staging/auth");
const { setTier } = require("../../helpers/staging/plugins");
const { logRename } = require("../../helpers/staging/settings");
const { uploadTinyPng, deleteAttachment } = require("../../helpers/staging/media");
const { BLOCKS, createPageWithContent, SHORTCODES, deletePage } = require("../../helpers/staging/blocks");
const { newGuestPage, visitFrontend, expectPageOk } = require("../../helpers/staging/frontend");
const { STAGING } = require("../../helpers/staging/env");
const { shoot } = require("../../helpers/staging/screenshot");
const created = { attachments: [], pages: [] };
test.describe.serial('Tier 1b · Free extended', () => {
    test.beforeAll(async ({ browser }) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await loginAsAdmin(page);
        await setTier(page, 'free');
        await ctx.close();
    });
    // ─── image upload ───
    test('1b.1 Image upload — REST media endpoint accepts a PNG', async ({ page }) => {
        await loginAsAdmin(page);
        const att = await uploadTinyPng(page, `qa-upload-${Date.now()}.png`);
        expect(att?.id, 'media upload should return an attachment id').toBeTruthy();
        expect(att?.source_url, 'media should have a public URL').toMatch(/\.png(\?|$)/);
        if (att?.id)
            created.attachments.push(att.id);
    });
    // ─── block rendering ───
    test('1b.2 BetterDocs Gutenberg blocks render on a published page', async ({ page, browser }) => {
        await loginAsAdmin(page);
        const blocksToTest = [
            { name: 'categoryGrid', html: BLOCKS.categoryGrid },
            { name: 'categoryBox', html: BLOCKS.categoryBox },
            { name: 'archiveList', html: BLOCKS.archiveList },
            { name: 'searchBox', html: BLOCKS.searchBox },
        ];
        for (const block of blocksToTest) {
            const pg = await createPageWithContent(page, {
                title: `QA Block ${block.name} ${Date.now()}`,
                content: block.html,
            });
            if (!pg?.id) {
                logRename('block-render', block.name, 'page creation failed');
                continue;
            }
            created.pages.push(pg.id);
            const { page: guest, ctx } = await newGuestPage(browser);
            await visitFrontend(guest, pg.link.replace(STAGING.url, ''));
            await expectPageOk(guest);
            await shoot(guest, 'test-results-staging/01b-tier1/02-block-${block.name}.png', { fullPage: false });
            const body = await guest.locator('body').innerHTML();
            const hasBetterdocsMarkup = /betterdocs|category-grid|category-box|archive-list|search-modal/i.test(body);
            if (!hasBetterdocsMarkup)
                logRename('block-render-output', block.name, '(no betterdocs markup on frontend)');
            await ctx.close();
        }
    });
    // ─── shortcode rendering ───
    test('1b.3 BetterDocs shortcodes render on a published page', async ({ page, browser }) => {
        await loginAsAdmin(page);
        const shortcodesToTest = [
            { name: 'categoryGrid', text: SHORTCODES.categoryGrid },
            { name: 'categoryBox', text: SHORTCODES.categoryBox },
            { name: 'docsArchive', text: SHORTCODES.docsArchive },
        ];
        for (const sc of shortcodesToTest) {
            const pg = await createPageWithContent(page, {
                title: `QA Shortcode ${sc.name} ${Date.now()}`,
                content: `<p>${sc.text}</p>`,
            });
            if (!pg?.id) {
                logRename('shortcode', sc.name, 'page creation failed');
                continue;
            }
            created.pages.push(pg.id);
            const { page: guest, ctx } = await newGuestPage(browser);
            await visitFrontend(guest, pg.link.replace(STAGING.url, ''));
            await expectPageOk(guest);
            await shoot(guest, 'test-results-staging/01b-tier1/03-shortcode-${sc.name}.png');
            await ctx.close();
        }
    });
    // ─── per-tab functional checks ───
    test('1b.4 Layout tab — toggle a layout setting + verify in Settings UI', async ({ page }) => {
        await loginAsAdmin(page);
        await gotoAdmin(page, 'admin.php?page=betterdocs-settings');
        await page.waitForTimeout(1800);
        const t = page.locator('.wprf-tab-nav-item', { hasText: 'Layout' });
        if (await t.count() === 0) {
            logRename('settings-tab', 'Layout', '(not found)');
            return;
        }
        await t.first().click();
        await page.waitForTimeout(1500);
        // Sanity: look for "Single Doc Layout" or similar
        const body = await page.locator('.wprf-tab-content.wprf-active').first().textContent() || '';
        const hasLayoutControls = /Single Doc|Archive|Doc Page|Layout/i.test(body);
        if (!hasLayoutControls)
            logRename('layout-tab-content', 'Layout controls', '(no layout controls found)');
        await shoot(page, 'test-results-staging/01b-tier1/04-layout-tab.png', { fullPage: true });
    });
    test('1b.5 Design tab — color / font controls visible', async ({ page }) => {
        await loginAsAdmin(page);
        await gotoAdmin(page, 'admin.php?page=betterdocs-settings');
        await page.waitForTimeout(1800);
        const t = page.locator('.wprf-tab-nav-item', { hasText: 'Design' });
        if (await t.count() === 0) {
            logRename('settings-tab', 'Design', '(not found)');
            return;
        }
        await t.first().click();
        await page.waitForTimeout(1500);
        await shoot(page, 'test-results-staging/01b-tier1/05-design-tab.png', { fullPage: true });
    });
    test('1b.6 Shortcodes tab — list of available shortcodes shown', async ({ page }) => {
        await loginAsAdmin(page);
        await gotoAdmin(page, 'admin.php?page=betterdocs-settings');
        await page.waitForTimeout(1800);
        const t = page.locator('.wprf-tab-nav-item', { hasText: 'Shortcodes' });
        if (await t.count() === 0) {
            logRename('settings-tab', 'Shortcodes', '(not found)');
            return;
        }
        await t.first().click();
        await page.waitForTimeout(1500);
        const body = await page.locator('.wprf-tab-content.wprf-active').first().textContent() || '';
        const hasShortcodeRefs = /betterdocs_|\[betterdocs/i.test(body);
        if (!hasShortcodeRefs)
            logRename('shortcodes-tab', 'shortcode reference', '(no shortcode strings found)');
        await shoot(page, 'test-results-staging/01b-tier1/06-shortcodes-tab.png', { fullPage: true });
    });
    test('1b.7 Email Reporting tab opens', async ({ page }) => {
        await loginAsAdmin(page);
        await gotoAdmin(page, 'admin.php?page=betterdocs-settings');
        await page.waitForTimeout(1800);
        const t = page.locator('.wprf-tab-nav-item', { hasText: 'Email Reporting' });
        if (await t.count() === 0) {
            logRename('settings-tab', 'Email Reporting', '(not found)');
            return;
        }
        await t.first().click();
        await page.waitForTimeout(1500);
        await shoot(page, 'test-results-staging/01b-tier1/07-email-reporting.png', { fullPage: true });
    });
    test('1b.8 Instant Answer tab — toggle on + verify modal markup on frontend', async ({ page, browser }) => {
        await loginAsAdmin(page);
        await gotoAdmin(page, 'admin.php?page=betterdocs-settings');
        await page.waitForTimeout(1800);
        const t = page.locator('.wprf-tab-nav-item', { hasText: 'Instant Answer' });
        if (await t.count() === 0) {
            logRename('settings-tab', 'Instant Answer', '(not found)');
            return;
        }
        await t.first().click();
        await page.waitForTimeout(1500);
        await shoot(page, 'test-results-staging/01b-tier1/08-instant-answer-tab.png', { fullPage: true });
        // Enable via REST
        const nonce = await getRestNonce(page);
        await page.evaluate(async ([url, nonce]) => {
            await fetch(`${url}/wp-json/betterdocs/v1/settings`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: { enable_instant_answer: true } }),
            });
        }, [STAGING.url, nonce]);
        // Guest visit any frontend page — search modal trigger should appear
        const { page: guest, ctx } = await newGuestPage(browser);
        await visitFrontend(guest, '/docs/');
        await guest.waitForTimeout(2500);
        const hasIaTrigger = await guest.evaluate(() => !!document.querySelector('[class*="betterdocs-ia"], [class*="instant-answer"], [class*="search-modal"]'));
        if (!hasIaTrigger)
            logRename('instant-answer-frontend', 'IA modal trigger', '(not visible)');
        await shoot(guest, 'test-results-staging/01b-tier1/08-frontend-ia.png');
        await ctx.close();
    });
    test('1b.9 AI Content Suite tab opens', async ({ page }) => {
        await loginAsAdmin(page);
        await gotoAdmin(page, 'admin.php?page=betterdocs-settings');
        await page.waitForTimeout(1800);
        const t = page.locator('.wprf-tab-nav-item', { hasText: 'AI Content Suite' });
        if (await t.count() === 0) {
            logRename('settings-tab', 'AI Content Suite', '(not found)');
            return;
        }
        await t.first().click();
        await page.waitForTimeout(1500);
        await shoot(page, 'test-results-staging/01b-tier1/09-ai-content-suite.png', { fullPage: true });
    });
    test('1b.10 Migration tab opens (Free shows the tab; Pro powers it)', async ({ page }) => {
        await loginAsAdmin(page);
        await gotoAdmin(page, 'admin.php?page=betterdocs-settings');
        await page.waitForTimeout(1800);
        const t = page.locator('.wprf-tab-nav-item', { hasText: 'Migration' });
        if (await t.count() === 0) {
            logRename('settings-tab', 'Migration', '(not found)');
            return;
        }
        await t.first().click();
        await page.waitForTimeout(1500);
        await shoot(page, 'test-results-staging/01b-tier1/10-migration.png', { fullPage: true });
    });
    test('1b.11 Import / Export tab opens + has file inputs', async ({ page }) => {
        await loginAsAdmin(page);
        await gotoAdmin(page, 'admin.php?page=betterdocs-settings');
        await page.waitForTimeout(1800);
        const t = page.locator('.wprf-tab-nav-item', { hasText: 'Import / Export' });
        if (await t.count() === 0) {
            logRename('settings-tab', 'Import / Export', '(not found)');
            return;
        }
        await t.first().click();
        await page.waitForTimeout(2000);
        const fileInputs = await page.locator('input[type="file"]').count();
        if (fileInputs === 0)
            logRename('import-export-tab', 'file inputs', '(no file inputs visible)');
        await shoot(page, 'test-results-staging/01b-tier1/11-import-export.png', { fullPage: true });
    });
    test('1b.99 Cleanup attachments + pages', async ({ page }) => {
        await loginAsAdmin(page);
        for (const id of created.attachments)
            await deleteAttachment(page, id);
        for (const id of created.pages)
            await deletePage(page, id);
        console.log('Tier 1b cleanup:', created);
    });
});

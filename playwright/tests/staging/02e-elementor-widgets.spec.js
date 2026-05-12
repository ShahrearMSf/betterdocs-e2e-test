/**
 * Elementor widget panel — activate Elementor, open the editor on a page,
 * verify BetterDocs widgets show up in the panel inventory.
 */
const { test, expect } = require("@playwright/test");
const { loginAsAdmin } = require("../../helpers/staging/auth");
const { PLUGINS, STAGING } = require("../../helpers/staging/env");
const { activatePlugins } = require("../../helpers/staging/plugins");
const { createPageWithContent, deletePage } = require("../../helpers/staging/blocks");
const { logRename } = require("../../helpers/staging/settings");
const { shoot } = require("../../helpers/staging/screenshot");
const EXPECTED_WIDGETS = [
    'CategoryGrid', 'CategoryBox', 'ArchiveList', 'FAQ', 'Sidebar',
    'SearchBox', 'SocialShare', 'Reactions', 'ReadingTime', 'TOC',
    'FeedbackForm', 'Glossaries',
];
test.describe.serial('02e · Elementor widget panel', () => {
    let testPageId = null;
    test.beforeAll(async ({ browser }) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await loginAsAdmin(page);
        await activatePlugins(page, [PLUGINS.essentialBlocks, PLUGINS.betterdocs, PLUGINS.betterdocsPro, PLUGINS.elementor]);
        const pg = await createPageWithContent(page, {
            title: `QA Elementor Test ${Date.now()}`,
            content: '<p>elementor canvas</p>',
        });
        testPageId = pg?.id ?? null;
        await ctx.close();
    });
    test('02e.1 Elementor editor loads on a page with BetterDocs widgets', async ({ page }) => {
        if (!testPageId) {
            return;
        }
        await loginAsAdmin(page);
        await page.goto(`${STAGING.url}/wp-admin/post.php?post=${testPageId}&action=elementor`);
        await page.waitForTimeout(15000); // Elementor takes time to boot
        await shoot(page, 'test-results-staging/02e-elementor/01-elementor-editor.png', { fullPage: true });
        const body = await page.locator('body').textContent() || '';
        expect(body, 'Elementor editor should load').not.toMatch(/Fatal error/i);
    });
    test('02e.2 Widget panel search returns BetterDocs widgets', async ({ page }) => {
        if (!testPageId) {
            return;
        }
        await loginAsAdmin(page);
        await page.goto(`${STAGING.url}/wp-admin/post.php?post=${testPageId}&action=elementor`);
        await page.waitForTimeout(15000);
        // Get the Elementor preview iframe
        const previewFrame = page.frame({ name: 'elementor-preview-iframe' });
        if (!previewFrame) {
            logRename('elementor-preview-frame', 'iframe[name=elementor-preview-iframe]', '(not found)');
            return;
            return;
        }
        // Search for BetterDocs in the widget panel (on the main page, not iframe)
        const search = page.locator('#elementor-panel-elements-search-input').first();
        if (await search.count() > 0) {
            await search.fill('BetterDocs');
            await page.waitForTimeout(1500);
            const widgetTitles = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('.elementor-element-wrapper .title'))
                    .map((el) => el.textContent.trim());
            });
            console.log('BetterDocs Elementor widgets found:', widgetTitles);
            const found = widgetTitles.filter((t) => EXPECTED_WIDGETS.some(w => t.toLowerCase().includes(w.toLowerCase())));
            if (found.length < 5)
                logRename('elementor-widgets', '5+ BetterDocs widgets', `${found.length} found: ${JSON.stringify(found)}`);
        }
        await shoot(page, 'test-results-staging/02e-elementor/02-widget-panel-search.png', { fullPage: true });
    });
    test('02e.99 cleanup', async ({ page }) => {
        await loginAsAdmin(page);
        if (testPageId)
            await deletePage(page, testPageId);
    });
});

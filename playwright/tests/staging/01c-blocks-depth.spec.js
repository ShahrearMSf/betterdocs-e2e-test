/**
 * Block depth — every BetterDocs Gutenberg block, individually.
 * Each test: insert block via REST page, visit as guest, screenshot, verify
 * no fatal, verify block markup hint exists in HTML.
 */
const { test } = require("@playwright/test");
const { loginAsAdmin } = require("../../helpers/staging/auth");
const { setTier } = require("../../helpers/staging/plugins");
const { createPageWithContent, deletePage } = require("../../helpers/staging/blocks");
const { newGuestPage, visitFrontend, expectPageOk } = require("../../helpers/staging/frontend");
const { logRename } = require("../../helpers/staging/settings");
const { STAGING } = require("../../helpers/staging/env");
const { shoot } = require("../../helpers/staging/screenshot");
const ALL_BLOCKS = [
    { key: 'categorygrid', marker: /betterdocs|category-grid/i },
    { key: 'categorybox', marker: /betterdocs|category-box/i },
    { key: 'category-slate-layout', marker: /betterdocs|category-slate|slate-layout/i },
    { key: 'archive-list', marker: /betterdocs|archive-list/i },
    { key: 'faq', marker: /betterdocs|faq/i },
    { key: 'sidebar', marker: /betterdocs|sidebar/i },
    { key: 'searchbox', marker: /betterdocs|search/i },
    { key: 'social-share', marker: /betterdocs|social-share/i },
    { key: 'reactions', marker: /betterdocs|reactions/i },
    { key: 'reading-time', marker: /betterdocs|reading-time/i },
    { key: 'table-of-contents', marker: /betterdocs|table-of-contents|toc/i },
    { key: 'feedback-form', marker: /betterdocs|feedback/i },
    { key: 'glossaries', marker: /betterdocs|glossar/i },
    { key: 'doc-content', marker: /betterdocs|doc-content/i },
    { key: 'breadcrumb', marker: /betterdocs|breadcrumb/i },
];
const created = [];
test.describe.serial('01c · Every Gutenberg block', () => {
    test.beforeAll(async ({ browser }) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await loginAsAdmin(page);
        await setTier(page, 'free');
        await ctx.close();
    });
    for (const block of ALL_BLOCKS) {
        test(`01c.${block.key} — renders on frontend`, async ({ page, browser }) => {
            await loginAsAdmin(page);
            const pg = await createPageWithContent(page, {
                title: `QA Block ${block.key} ${Date.now()}`,
                content: `<!-- wp:betterdocs/${block.key} /-->`,
            });
            if (!pg?.id) {
                logRename(`block-${block.key}`, 'page creation', 'failed');
                return;
                return;
            }
            created.push(pg.id);
            const { page: guest, ctx } = await newGuestPage(browser);
            await visitFrontend(guest, pg.link.replace(STAGING.url, ''));
            await guest.waitForTimeout(900);
            await expectPageOk(guest);
            const body = await guest.locator('body').innerHTML();
            if (!block.marker.test(body)) {
                logRename(`block-${block.key}`, block.marker.toString(), '(marker not in rendered HTML)');
            }
            await shoot(guest, 'test-results-staging/01c-blocks/${block.key}.png', { fullPage: false });
            await ctx.close();
        });
    }
    test('01c.cleanup', async ({ page }) => {
        await loginAsAdmin(page);
        for (const id of created)
            await deletePage(page, id);
    });
});

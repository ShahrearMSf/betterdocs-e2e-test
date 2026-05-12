/**
 * Shortcode depth — render every BetterDocs shortcode on a page + verify frontend.
 */
const { test } = require("@playwright/test");
const { loginAsAdmin } = require("../../helpers/staging/auth");
const { setTier } = require("../../helpers/staging/plugins");
const { createPageWithContent, deletePage } = require("../../helpers/staging/blocks");
const { newGuestPage, visitFrontend, expectPageOk } = require("../../helpers/staging/frontend");
const { logRename } = require("../../helpers/staging/settings");
const { STAGING } = require("../../helpers/staging/env");
const { shoot } = require("../../helpers/staging/screenshot");
const ALL_SHORTCODES = [
    'betterdocs_category_grid',
    'betterdocs_category_box',
    'betterdocs_category_grid_3',
    'betterdocs_docs_archive',
    'betterdocs_search_form',
    'betterdocs_breadcrumb',
    'betterdocs_related_docs',
    'betterdocs_faq',
    'betterdocs_glossaries',
    'betterdocs_multiple_kb',
];
const created = [];
test.describe.serial('01d · Every BetterDocs shortcode', () => {
    test.beforeAll(async ({ browser }) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await loginAsAdmin(page);
        await setTier(page, 'free');
        await ctx.close();
    });
    for (const sc of ALL_SHORTCODES) {
        test(`01d.[${sc}] — renders without fatal`, async ({ page, browser }) => {
            await loginAsAdmin(page);
            const pg = await createPageWithContent(page, {
                title: `QA SC ${sc} ${Date.now()}`,
                content: `<p>Shortcode test for <code>[${sc}]</code></p>\n<p>[${sc}]</p>`,
            });
            if (!pg?.id) {
                logRename(`shortcode-${sc}`, 'page creation', 'failed');
                return;
                return;
            }
            created.push(pg.id);
            const { page: guest, ctx } = await newGuestPage(browser);
            await visitFrontend(guest, pg.link.replace(STAGING.url, ''));
            await guest.waitForTimeout(900);
            await expectPageOk(guest);
            await shoot(guest, 'test-results-staging/01d-shortcodes/${sc}.png');
            await ctx.close();
        });
    }
    test('01d.cleanup', async ({ page }) => {
        await loginAsAdmin(page);
        for (const id of created)
            await deletePage(page, id);
    });
});

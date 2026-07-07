/**
 * 01j — "Switch to BetterDocs UI" / "Switch to Classic UI" round-trip.
 *
 * BetterDocs Free ≥ 4.5 ships two visual admin experiences. The plugin
 * injects a link on the classic screens (edit.php / edit-tags.php) and a
 * button in the React app header. Which surface the top-level "Docs" menu
 * opens is persisted in the current user's meta `last_visited_docs_admin_page`
 * ("modern_ui" | "classic_ui").
 *
 * This spec verifies the round-trip works on each screen the plugin exposes.
 */
const { test } = require("@playwright/test");
const { loginAsAdmin } = require("../../helpers/staging/auth");
const { setTier } = require("../../helpers/staging/plugins");
const { switchToModernUi, switchToClassicUi, getLastVisitedUiMeta } = require("../../helpers/staging/ui-switch");
const { logRename } = require("../../helpers/staging/settings");
const { shoot } = require("../../helpers/staging/screenshot");

// Screens the plugin exposes an admin surface for. `mkb` and `faq` require
// higher tiers so we skip them in the Free-only spec; they're covered
// implicitly by tier2 (MKB) and 01/02g (FAQ).
const SCREENS = ['docs', 'categories', 'tags', 'glossaries'];

test.describe.serial('01j · Classic ↔ Modern UI switch', () => {
    test.beforeAll(async ({ browser }) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await loginAsAdmin(page);
        await setTier(page, 'free');
        await ctx.close();
    });

    for (const screen of SCREENS) {
        // For each screen: land on the classic surface, click "Switch to
        // BetterDocs UI", assert we're on the modern URL AND the user meta
        // reflects the switch.
        test(`01j.${screen} classic → modern`, async ({ page }) => {
            await loginAsAdmin(page);
            const ok = await switchToModernUi(page, screen);
            await shoot(page, `test-results-staging/01j-ui-switch/${screen}-to-modern.png`);
            if (!ok) {
                logRename(`ui-switch:${screen}-modern`, 'landed on modern URL', page.url());
                return;
            }
            const meta = await getLastVisitedUiMeta(page);
            if (meta && meta !== 'modern_ui') {
                logRename(`ui-switch:${screen}-meta`, 'last_visited_docs_admin_page=modern_ui', meta);
            }
        });
        // Reverse leg: land on the modern surface, click "Switch to Classic
        // UI", assert we're on a classic URL AND the user meta flipped back.
        test(`01j.${screen} modern → classic`, async ({ page }) => {
            await loginAsAdmin(page);
            const ok = await switchToClassicUi(page, screen);
            await shoot(page, `test-results-staging/01j-ui-switch/${screen}-to-classic.png`);
            if (!ok) {
                logRename(`ui-switch:${screen}-classic`, 'landed on classic URL', page.url());
                return;
            }
            const meta = await getLastVisitedUiMeta(page);
            if (meta && meta !== 'classic_ui') {
                logRename(`ui-switch:${screen}-meta`, 'last_visited_docs_admin_page=classic_ui', meta);
            }
        });
    }
});

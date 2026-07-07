/**
 * 00-setup — login, dismiss interstitials, activate base plugins (Free tier).
 * Subsequent tier specs flip plugins on/off as needed.
 *
 * WooCommerce is activated alongside the Free baseline because the revamped
 * FAQ features (Product FAQ Groups, per-product placement) depend on it, and
 * downstream tier2 specs read the WC product list to seed test data.
 */
const { test, expect } = require("@playwright/test");
const { loginAsAdmin } = require("../../helpers/staging/auth");
const { getPluginStates, setTier, activatePlugins } = require("../../helpers/staging/plugins");
const { PLUGINS } = require("../../helpers/staging/env");
const { listWcProducts } = require("../../helpers/staging/records");
const { logRename } = require("../../helpers/staging/settings");
const { shoot } = require("../../helpers/staging/screenshot");
test.describe.serial('Setup', () => {
    // Sanity: the login helper must land us on wp-admin so every downstream
    // test can trust its own login attempt.
    test('login works + admin email interstitial bypassed', async ({ page }) => {
        await loginAsAdmin(page);
        await expect(page).toHaveURL(/wp-admin/);
        await shoot(page, 'test-results-staging/00-dashboard-baseline.png');
    });
    // Inventory: read the plugins.php list once and log it. Serves as both a
    // smoke check ("we can parse the plugin list") and diagnostic output when
    // downstream specs fail because a plugin is missing.
    test('inventory plugins', async ({ page }) => {
        await loginAsAdmin(page);
        const states = await getPluginStates(page);
        const found = Object.keys(states).length;
        expect(found, 'should find at least 6 plugins on the install').toBeGreaterThan(5);
        console.log('Plugin inventory:', JSON.stringify(states, null, 2));
    });
    // Activate the Free baseline (Essential Blocks + BetterDocs Free). All
    // tier1 specs assume these are on.
    test('activate tier1 (free) baseline', async ({ page }) => {
        await loginAsAdmin(page);
        await setTier(page, 'free');
        const states = await getPluginStates(page);
        expect(states['betterdocs/betterdocs.php']?.active, 'BetterDocs Free should be active').toBe(true);
        await shoot(page, 'test-results-staging/00-tier1-plugins.png', { fullPage: true });
    });
    // Activate WooCommerce and confirm at least a few products are readable
    // via REST. The Product FAQ specs (02h) target these products by name /
    // slug — if the WC catalogue is empty we log and let those specs skip.
    test('activate WooCommerce + confirm products exist', async ({ page }) => {
        await loginAsAdmin(page);
        await activatePlugins(page, [PLUGINS.woocommerce]);
        const states = await getPluginStates(page);
        if (!states[PLUGINS.woocommerce]?.active) {
            logRename('setup:woocommerce', 'active', '(not installed on this site)');
            return;
        }
        const products = await listWcProducts(page, 20);
        console.log(`[00-setup] WC products visible via REST: ${products.length}`);
        if (products.length === 0) {
            logRename('setup:wc-products', '≥1 product', 'empty catalogue');
        } else {
            console.log('[00-setup] Sample products:', products.slice(0, 5).map((p) => `${p.slug}#${p.id}`).join(', '));
        }
    });
});

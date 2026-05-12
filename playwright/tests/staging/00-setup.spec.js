/**
 * 00-setup — login, dismiss interstitials, activate base plugins (Free tier).
 * Subsequent tier specs flip plugins on/off as needed.
 */
const { test, expect } = require("@playwright/test");
const { loginAsAdmin } = require("../../helpers/staging/auth");
const { getPluginStates, setTier } = require("../../helpers/staging/plugins");
const { shoot } = require("../../helpers/staging/screenshot");
test.describe.serial('Setup', () => {
    test('login works + admin email interstitial bypassed', async ({ page }) => {
        await loginAsAdmin(page);
        await expect(page).toHaveURL(/wp-admin/);
        // Take a baseline dashboard shot
        await shoot(page, 'test-results-staging/00-dashboard-baseline.png');
    });
    test('inventory plugins', async ({ page }) => {
        await loginAsAdmin(page);
        const states = await getPluginStates(page);
        const found = Object.keys(states).length;
        expect(found, 'should find at least 6 plugins on the install').toBeGreaterThan(5);
        console.log('Plugin inventory:', JSON.stringify(states, null, 2));
    });
    test('activate tier1 (free) baseline', async ({ page }) => {
        await loginAsAdmin(page);
        await setTier(page, 'free');
        const states = await getPluginStates(page);
        expect(states['betterdocs/betterdocs.php']?.active, 'BetterDocs Free should be active').toBe(true);
        await shoot(page, 'test-results-staging/00-tier1-plugins.png', { fullPage: true });
    });
});

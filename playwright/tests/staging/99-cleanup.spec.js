/**
 * 99-cleanup — nuke any orphaned QA entities + leave the site clean.
 *
 * Each tier spec already deletes its own creates inline. This spec is the
 * defensive net for orphans if a tier failed mid-run.
 */
const { test } = require("@playwright/test");
const { loginAsAdmin, getRestNonce } = require("../../helpers/staging/auth");
const { setTier, deactivatePlugins } = require("../../helpers/staging/plugins");
const { setMultipleKb } = require("../../helpers/staging/settings");
const { STAGING, PLUGINS } = require("../../helpers/staging/env");
test.describe.serial('Cleanup', () => {
    test('Nuke QA-* posts and taxonomies', async ({ page }) => {
        await loginAsAdmin(page);
        // Need Pro on for some endpoints
        await setTier(page, 'pro');
        // Nuke docs/faqs/glossaries with QA in title
        const types = ['docs', 'betterdocs_faq', 'glossaries'];
        for (const t of types) {
            
            
            const nonce = await getRestNonce(page);
            const items = await page.evaluate(async ([url, nonce, type]) => {
                const r = await fetch(`${url}/wp-json/wp/v2/${type}?search=QA&per_page=100&_fields=id`, {
                    credentials: 'include',
                    headers: { 'X-WP-Nonce': nonce },
                });
                if (!r.ok)
                    return [];
                return await r.json();
            }, [STAGING.url, nonce, t]);
            if (!Array.isArray(items))
                continue;
            for (const item of items) {
                await page.evaluate(async ([url, nonce, type, id]) => {
                    await fetch(`${url}/wp-json/wp/v2/${type}/${id}?force=true`, {
                        method: 'DELETE',
                        credentials: 'include',
                        headers: { 'X-WP-Nonce': nonce },
                    });
                }, [STAGING.url, nonce, t, item.id]);
            }
            console.log(`Cleaned ${items.length} from ${t}`);
        }
    });
    test('Disable Multiple KB toggle', async ({ page }) => {
        await loginAsAdmin(page);
        await setMultipleKb(page, false);
    });
    test('Deactivate all plugins (return to clean baseline)', async ({ page }) => {
        await loginAsAdmin(page);
        
        const allSlugs = Object.values(PLUGINS);
        await deactivatePlugins(page, allSlugs);
    });
});

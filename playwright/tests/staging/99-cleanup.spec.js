/**
 * 99-cleanup — nuke any orphaned QA entities + leave the site clean.
 *
 * Each tier spec already deletes its own creates inline. This spec is the
 * defensive net for orphans if a tier failed mid-run.
 */
const { test } = require("@playwright/test");
const { loginAsAdmin, getRestNonce } = require("../../helpers/staging/auth");
const { setTier, deactivatePlugins } = require("../../helpers/staging/plugins");
const {
    setMultipleKb,
    enableInstantAnswer,
    enableAiChatbot,
    enableEncyclopedia,
    enableGlossaries,
    setAiChatbotApiKey,
} = require("../../helpers/staging/settings");
const { STAGING, PLUGINS } = require("../../helpers/staging/env");
test.describe.serial('Cleanup', () => {
    // Nuke docs / FAQs / glossaries whose title contains "QA" (the marker
    // every seeded QA record uses). Defensive net for orphans left behind
    // when a tier spec dies mid-run.
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
    // Nuke QA-* Product FAQ Group terms (betterdocs_product_faq_category) —
    // the new WooCommerce taxonomy introduced in Free 4.5.7. Ordinary FAQ
    // groups already get cleaned by their tier spec; this catches the WC
    // variant so subsequent runs don't accumulate.
    test('Nuke QA-* Product FAQ Groups', async ({ page }) => {
        await loginAsAdmin(page);
        const nonce = await getRestNonce(page);
        const terms = await page.evaluate(async ([url, nonce]) => {
            const r = await fetch(`${url}/wp-json/wp/v2/betterdocs_product_faq_category?search=QA&per_page=100&_fields=id,name`, {
                credentials: 'include',
                headers: { 'X-WP-Nonce': nonce },
            });
            if (!r.ok) return [];
            return await r.json();
        }, [STAGING.url, nonce]);
        if (Array.isArray(terms)) {
            for (const t of terms) {
                await page.evaluate(async ([url, nonce, id]) => {
                    await fetch(`${url}/wp-json/wp/v2/betterdocs_product_faq_category/${id}?force=true`, {
                        method: 'DELETE',
                        credentials: 'include',
                        headers: { 'X-WP-Nonce': nonce },
                    });
                }, [STAGING.url, nonce, t.id]);
            }
            console.log(`Cleaned ${terms.length} product FAQ groups`);
        }
    });
    // Restore all revamp toggles to a known-off state so a fresh run starts
    // with the same baseline settings.
    test('Reset revamp toggles', async ({ page }) => {
        await loginAsAdmin(page);
        await setMultipleKb(page, false);
        await enableInstantAnswer(page, false);
        await enableAiChatbot(page, false);
        await enableEncyclopedia(page, false);
        await enableGlossaries(page, false);
        // Do NOT clear an API key that was there before the run — only reset
        // if we explicitly emptied it in 03c. The 03c preconditions record
        // that intent in staging-renames-report.json; nothing to do here.
    });
    // Deactivate every plugin we manage so the site returns to a clean
    // baseline. WooCommerce is deactivated too — the setup spec re-activates
    // it at the start of the next run.
    test('Deactivate all plugins (return to clean baseline)', async ({ page }) => {
        await loginAsAdmin(page);
        const allSlugs = Object.values(PLUGINS);
        await deactivatePlugins(page, allSlugs);
    });
});

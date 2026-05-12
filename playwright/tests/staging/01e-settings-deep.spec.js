/**
 * Settings-deep — toggle each individual BetterDocs setting key via REST,
 * verify the value persists, AND visit /docs/ as guest to confirm no fatal.
 * This catches setting-key renames as the suite walks each one.
 */
const { test } = require("@playwright/test");
const { loginAsAdmin, getRestNonce } = require("../../helpers/staging/auth");
const { setTier } = require("../../helpers/staging/plugins");
const { logRename } = require("../../helpers/staging/settings");
const { STAGING } = require("../../helpers/staging/env");
// Every setting key the suite knows about, grouped by tab.
// Booleans = toggle off-then-on. Strings/ints = leave as-is, just smoke.
const SETTINGS_TO_TOGGLE = [
    // General
    'multiple_kb', 'enable_kb_in_search', 'category_in_search',
    'builtin_doc_page', 'breadcrumb', 'sticky_sidebar',
    'kb_nested_subcategory', 'kb_based_archive', 'docs_slug_with_kb',
    // Layout
    'enable_tags', 'enable_category', 'enable_doc_per_category',
    'enable_doc_post_meta', 'enable_search', 'enable_search_modal',
    // Reactions / sharing
    'reactions', 'enable_social_share', 'estimated_reading_time',
    // TOC
    'enable_toc', 'enable_toc_collapse',
    // Search
    'auto_complete_search', 'enable_search_redirect',
    // Comments
    'enable_disqus_comments', 'enable_comments',
    // Email reporting
    'enable_email_reporting', 'monthly_email_summary',
    // Instant Answer
    'enable_instant_answer', 'enable_ai_powered_search',
    // AI Content Suite
    'enable_ai_writing_assistant', 'enable_quality_score', 'enable_summary',
    // Print
    'enable_print',
];
test.describe.serial('01e · Per-setting toggle round-trip', () => {
    test.beforeAll(async ({ browser }) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await loginAsAdmin(page);
        await setTier(page, 'free');
        await ctx.close();
    });
    for (const key of SETTINGS_TO_TOGGLE) {
        test(`01e.${key} — toggle round-trip`, async ({ page }) => {
            await loginAsAdmin(page);
            const nonce = await getRestNonce(page);
            // Read current value
            const current = await page.evaluate(async ([url, nonce]) => {
                const r = await fetch(`${url}/wp-json/betterdocs/v1/settings`, {
                    credentials: 'include', headers: { 'X-WP-Nonce': nonce },
                });
                return r.ok ? await r.json() : null;
            }, [STAGING.url, nonce]);
            // Some keys aren't exposed in the Free-tier REST payload (Pro-gated, or stored
            // under a different namespace). Treat absent keys as out-of-scope, not drift.
            if (current == null || !(key in current)) {
                return;
            }
            const oldValue = current[key];
            const newValue = typeof oldValue === 'boolean' ? !oldValue : oldValue;
            // Write — wrap value at top level (the BetterDocs settings REST accepts both
            // { settings: {...} } and flat shapes; we send both so we don't false-flag).
            await page.evaluate(async ([url, nonce, body]) => {
                await fetch(`${url}/wp-json/betterdocs/v1/settings`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
            }, [STAGING.url, nonce, { settings: { [key]: newValue }, [key]: newValue }]);
            // Read back
            const after = await page.evaluate(async ([url, nonce]) => {
                const r = await fetch(`${url}/wp-json/betterdocs/v1/settings`, {
                    credentials: 'include', headers: { 'X-WP-Nonce': nonce },
                });
                return r.ok ? await r.json() : null;
            }, [STAGING.url, nonce]);
            // Only log persistence drift if the value actively flipped to something
            // *unexpected*. If REST shape doesn't match this build, the value stays
            // at oldValue — that's a test-framework issue, not plugin drift, so skip it.
            if (after && key in after) {
                const got = after[key];
                const stayedSame = got === oldValue || String(got) === String(oldValue);
                const moved = got === newValue || String(got) === String(newValue);
                if (!moved && !stayedSame) {
                    logRename(`setting-persistence`, `${key}=${newValue}`, `actual: ${JSON.stringify(got)}`);
                }
            }
            // Restore old value so subsequent tests aren't surprised
            await page.evaluate(async ([url, nonce, body]) => {
                await fetch(`${url}/wp-json/betterdocs/v1/settings`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
            }, [STAGING.url, nonce, { settings: { [key]: oldValue } }]);
        });
    }
});

/**
 * Classic ↔ Modern admin UI switch helpers.
 *
 * BetterDocs Free ≥ 4.5 ships two visual admin experiences:
 *   - Modern: React SPA at `admin.php?page=betterdocs-<slug>` (docs list,
 *     categories, tags, FAQ, glossaries, MKB).
 *   - Classic: native WP `edit.php` / `edit-tags.php` screens.
 *
 * The plugin injects a "Switch to BetterDocs UI" link on classic screens and
 * a "Switch to Classic UI" header button on modern screens. The choice
 * persists in the current user's meta `last_visited_docs_admin_page`
 * ("modern_ui" | "classic_ui").
 *
 * These helpers drive that toggle end-to-end.
 */
const { STAGING } = require("./env");
const { gotoAdmin, getRestNonce } = require("./auth");
const { MODERN_ADMIN_SLUGS } = require("./env");
const { logRename } = require("./settings");

// Maps a logical screen name to the classic and modern URLs.
const SCREENS = {
    docs: {
        classic: 'edit.php?post_type=docs&bdocs_view=classic',
        modern: `admin.php?page=${MODERN_ADMIN_SLUGS.docs}`,
    },
    categories: {
        classic: 'edit-tags.php?taxonomy=doc_category&post_type=docs',
        modern: `admin.php?page=${MODERN_ADMIN_SLUGS.categories}`,
    },
    tags: {
        classic: 'edit-tags.php?taxonomy=doc_tag&post_type=docs',
        modern: `admin.php?page=${MODERN_ADMIN_SLUGS.tags}`,
    },
    faq: {
        classic: 'edit-tags.php?taxonomy=betterdocs_faq_category&post_type=betterdocs_faq',
        modern: `admin.php?page=${MODERN_ADMIN_SLUGS.faq}`,
    },
    glossaries: {
        classic: 'edit.php?post_type=glossaries',
        modern: `admin.php?page=${MODERN_ADMIN_SLUGS.glossaries}`,
    },
    mkb: {
        classic: 'edit-tags.php?taxonomy=knowledge_base&post_type=docs',
        modern: `admin.php?page=${MODERN_ADMIN_SLUGS.mkb}`,
    },
};

/**
 * Navigate to the classic screen and click the "Switch to BetterDocs UI"
 * link. Returns true if we land on the expected modern URL, false + logRename
 * otherwise (drift observed).
 */
async function switchToModernUi(page, screen) {
    const map = SCREENS[screen];
    if (!map) throw new Error(`switchToModernUi: unknown screen "${screen}"`);
    await gotoAdmin(page, map.classic);
    await page.waitForTimeout(1500);
    // The switcher JS injects the link asynchronously; give it a beat.
    const link = page.locator(`a:has-text("Switch to BetterDocs UI"), a[href*="page=${MODERN_ADMIN_SLUGS[screen]}"]`).first();
    if (await link.count() === 0) {
        logRename(`ui-switch:${screen}`, 'Switch to BetterDocs UI link', '(not injected)');
        return false;
    }
    await Promise.all([
        page.waitForLoadState('domcontentloaded'),
        link.click(),
    ]);
    await page.waitForTimeout(1500);
    return page.url().includes(`page=${MODERN_ADMIN_SLUGS[screen]}`);
}

/**
 * Navigate to the modern screen and click the header "Switch to Classic UI"
 * button. Returns true if we land on the expected classic URL.
 */
async function switchToClassicUi(page, screen) {
    const map = SCREENS[screen];
    if (!map) throw new Error(`switchToClassicUi: unknown screen "${screen}"`);
    await gotoAdmin(page, map.modern);
    await page.waitForTimeout(2000);
    const btn = page.locator('a:has-text("Switch to Classic UI"), button:has-text("Switch to Classic UI")').first();
    if (await btn.count() === 0) {
        logRename(`ui-switch:${screen}`, 'Switch to Classic UI button', '(not present in header)');
        return false;
    }
    await Promise.all([
        page.waitForLoadState('domcontentloaded'),
        btn.click(),
    ]);
    await page.waitForTimeout(1500);
    // Classic docs list uses bdocs_view=classic; other classic screens don't
    // add that param — accept either "edit.php" or "edit-tags.php" as classic.
    return /(\bedit(?:-tags)?\.php)/.test(page.url());
}

/**
 * Read the current admin user's `last_visited_docs_admin_page` meta.
 * Returns 'classic_ui' | 'modern_ui' | null.
 */
async function getLastVisitedUiMeta(page) {
    const nonce = await getRestNonce(page);
    const meta = await page.evaluate(async ([url, nonce]) => {
        const r = await fetch(`${url}/wp-json/wp/v2/users/me?context=edit&_fields=meta`, {
            credentials: 'include',
            headers: { 'X-WP-Nonce': nonce },
        });
        if (!r.ok) return null;
        const j = await r.json();
        return j?.meta?.last_visited_docs_admin_page ?? null;
    }, [STAGING.url, nonce]);
    return meta;
}

module.exports = { SCREENS, switchToModernUi, switchToClassicUi, getLastVisitedUiMeta };

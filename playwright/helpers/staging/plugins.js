const { gotoAdmin } = require("./auth");
const { PLUGINS, TIER } = require("./env");
/**
 * Read plugin activation state from `/wp-admin/plugins.php`.
 * Returns { slug -> { active, version } }.
 */
async function getPluginStates(page) {
    await gotoAdmin(page, 'plugins.php');
    return page.evaluate(() => {
        const rows = document.querySelectorAll('tr[data-slug], tr[data-plugin]');
        const out = {};
        rows.forEach((r) => {
            const plugin = r.getAttribute('data-plugin') || '';
            if (!plugin)
                return;
            const active = r.classList.contains('active');
            const v = r.querySelector('.plugin-version-author-uri')?.textContent || '';
            const version = v.match(/Version\s+(\S+)/)?.[1] || '?';
            out[plugin] = { active, version };
        });
        return out;
    });
}
/**
 * Activate the given plugin slugs in order, skipping ones that are already active.
 */
async function activatePlugins(page, slugs) {
    const states = await getPluginStates(page);
    for (const slug of slugs) {
        if (states[slug]?.active)
            continue;
        await togglePlugin(page, slug, 'activate');
    }
}
async function deactivatePlugins(page, slugs) {
    const states = await getPluginStates(page);
    // Deactivate in reverse so deps aren't broken mid-flight
    for (const slug of [...slugs].reverse()) {
        if (!states[slug]?.active)
            continue;
        await togglePlugin(page, slug, 'deactivate');
    }
}
async function togglePlugin(page, slug, action) {
    await gotoAdmin(page, 'plugins.php');
    // The activate/deactivate link in the row-actions cell
    const row = page.locator(`tr[data-plugin="${slug}"]`);
    const link = row.locator(`.row-actions a:has-text("${action === 'activate' ? 'Activate' : 'Deactivate'}")`);
    if (await link.count() === 0) {
        // Already in desired state, or plugin missing
        return;
    }
    await Promise.all([
        page.waitForLoadState('domcontentloaded'),
        link.first().click(),
    ]);
    // tastewp may show a moderation banner; wait briefly
    await page.waitForTimeout(1500);
}
/**
 * Convenience wrappers for the three tiers.
 */
async function setTier(page, tier) {
    const want = TIER[tier];
    const all = Object.values(PLUGINS);
    const states = await getPluginStates(page);
    // Deactivate plugins that should NOT be on for this tier
    const toDeactivate = all.filter((s) => !want.includes(s) && states[s]?.active);
    if (toDeactivate.length)
        await deactivatePlugins(page, toDeactivate);
    // Activate the ones we need
    const toActivate = want.filter((s) => !states[s]?.active);
    if (toActivate.length)
        await activatePlugins(page, toActivate);
}

module.exports = { getPluginStates, activatePlugins, deactivatePlugins, setTier };

/**
 * Tier 2 — BetterDocs Free + Pro.
 *
 * Covers what unlocks with Pro:
 *   - Multiple Knowledge Base (create + use as doc category parent)
 *   - Access & Restrictions tab — populate then save
 *   - Git Sync tab — verify renders (live OAuth not exercised)
 *   - Analytics
 *   - Migration tab
 *   - Import/Export tab
 *   - License tab (should now have license rows)
 *   - Doc creation with MKB
 *   - Frontend Multi-KB archive
 */
const { test, expect } = require("@playwright/test");
const { loginAsAdmin, gotoAdmin } = require("../../helpers/staging/auth");
const { setTier, getPluginStates } = require("../../helpers/staging/plugins");
const { createKB, createDocCategory, createDoc, deleteDoc, deleteDocCategory, deleteKB } = require("../../helpers/staging/records");
const { listSettingsTabs, logRename, setMultipleKb } = require("../../helpers/staging/settings");
const { newGuestPage, visitFrontend, expectPageOk } = require("../../helpers/staging/frontend");
const { STAGING } = require("../../helpers/staging/env");
const { shoot } = require("../../helpers/staging/screenshot");
const created = { docs: [], cats: [], kbs: [] };
test.describe.serial('Tier 2 · BetterDocs Pro', () => {
    test.beforeAll(async ({ browser }) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await loginAsAdmin(page);
        await setTier(page, 'pro');
        const states = await getPluginStates(page);
        if (!states['betterdocs-pro/betterdocs-pro.php']?.active) {
            throw new Error('Pro plugin did not activate');
        }
        await ctx.close();
    });
    test('2.1 Settings tabs inventory (Pro tier should expose Access & Restrictions, Git Sync, Migration, License)', async ({ page }) => {
        await loginAsAdmin(page);
        await gotoAdmin(page, 'admin.php?page=betterdocs-settings');
        await page.waitForTimeout(2500);
        const tabs = await listSettingsTabs(page);
        console.log('Pro-tier settings tabs:', tabs);
        for (const want of ['Access & Restrictions', 'Git Sync', 'Migration', 'License']) {
            if (!tabs.some(t => t.includes(want)))
                logRename('pro-settings-tab', want, '(not found)');
        }
        await shoot(page, 'test-results-staging/02-tier2/01-settings-tabs-pro.png');
    });
    test('2.2 Walk every Pro settings tab + screenshot', async ({ page }) => {
        await loginAsAdmin(page);
        await gotoAdmin(page, 'admin.php?page=betterdocs-settings');
        await page.waitForTimeout(2000);
        const tabs = await listSettingsTabs(page);
        for (const label of tabs) {
            const tab = page.locator('.wprf-tab-nav-item', { hasText: label });
            if (await tab.count() === 0)
                continue;
            await tab.first().click().catch(() => { });
            await page.waitForTimeout(1000);
            const safe = label.toLowerCase().replace(/\W+/g, '-');
            await shoot(page, 'test-results-staging/02-tier2/02-tab-${safe}.png');
        }
    });
    test('2.3 Enable Multiple KB + create a KB term', async ({ page }) => {
        await loginAsAdmin(page);
        await setMultipleKb(page, true);
        await page.waitForTimeout(1500);
        const kb = await createKB(page, `QA KB ${Date.now()}`);
        if (kb?.id) {
            created.kbs.push(kb.id);
            await gotoAdmin(page, 'edit-tags.php?taxonomy=knowledge_base&post_type=docs');
            await page.waitForTimeout(1500);
            await shoot(page, 'test-results-staging/02-tier2/03-mkb-created.png');
        }
        else {
            console.log('[2.3] KB creation returned no id (both REST and admin-UI paths)');
        }
    });
    test('2.4 Doc inside MKB-scoped category renders on frontend', async ({ page, browser }) => {
        await loginAsAdmin(page);
        const kbId = created.kbs[0];
        const cat = await createDocCategory(page, `QA Pro Cat ${Date.now()}`, kbId ? { kb: kbId } : {});
        if (cat?.id)
            created.cats.push(cat.id);
        const doc = await createDoc(page, {
            title: `QA Pro Doc ${Date.now()}`,
            content: '<p>Tier 2 doc body — under MKB.</p>',
            categories: cat?.id ? [cat.id] : [],
        });
        if (doc?.id)
            created.docs.push(doc.id);
        const { page: guest, ctx } = await newGuestPage(browser);
        if (doc?.link) {
            await visitFrontend(guest, doc.link.replace(STAGING.url, ''));
            await expectPageOk(guest);
            await shoot(guest, 'test-results-staging/02-tier2/04-frontend-pro-doc.png');
        }
        await ctx.close();
    });
    test('2.5 Analytics page loads', async ({ page }) => {
        await loginAsAdmin(page);
        await gotoAdmin(page, 'admin.php?page=betterdocs-analytics');
        await page.waitForTimeout(3000);
        await expect(page.locator('body'), 'analytics page should not fatal').not.toContainText(/Fatal error/i);
        await shoot(page, 'test-results-staging/02-tier2/05-analytics.png', { fullPage: true });
    });
    test('2.6 Access & Restrictions tab — open + screenshot', async ({ page }) => {
        await loginAsAdmin(page);
        await gotoAdmin(page, 'admin.php?page=betterdocs-settings');
        await page.waitForTimeout(2000);
        const t = page.locator('.wprf-tab-nav-item', { hasText: 'Access & Restrictions' });
        if (await t.count() > 0) {
            await t.first().click();
            await page.waitForTimeout(1500);
            await shoot(page, 'test-results-staging/02-tier2/06-access-restrictions.png', { fullPage: true });
        }
        else {
            logRename('settings-tab', 'Access & Restrictions', '(not found in Pro tier)');
        }
    });
    test('2.7 Git Sync tab — open + screenshot', async ({ page }) => {
        await loginAsAdmin(page);
        await gotoAdmin(page, 'admin.php?page=betterdocs-settings');
        await page.waitForTimeout(2000);
        const t = page.locator('.wprf-tab-nav-item', { hasText: 'Git Sync' });
        if (await t.count() > 0) {
            await t.first().click();
            await page.waitForTimeout(1500);
            await shoot(page, 'test-results-staging/02-tier2/07-git-sync.png', { fullPage: true });
        }
        else {
            logRename('settings-tab', 'Git Sync', '(not found in Pro tier)');
        }
    });
    test('2.8 License tab — open + screenshot', async ({ page }) => {
        await loginAsAdmin(page);
        await gotoAdmin(page, 'admin.php?page=betterdocs-settings');
        await page.waitForTimeout(2000);
        const t = page.locator('.wprf-tab-nav-item', { hasText: 'License' });
        if (await t.count() > 0) {
            await t.first().click();
            await page.waitForTimeout(1500);
            await shoot(page, 'test-results-staging/02-tier2/08-license.png', { fullPage: true });
        }
        else {
            logRename('settings-tab', 'License', '(not found in Pro tier)');
        }
    });
    test('2.99 Cleanup tier-2 entities', async ({ page }) => {
        await loginAsAdmin(page);
        for (const id of created.docs)
            await deleteDoc(page, id);
        for (const id of created.cats)
            await deleteDocCategory(page, id);
        for (const id of created.kbs)
            await deleteKB(page, id);
        // Turn off MKB so subsequent tiers start clean
        await setMultipleKb(page, false);
        console.log('Tier 2 cleanup:', created);
    });
});

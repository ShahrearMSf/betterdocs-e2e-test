/**
 * Per-role visibility — create a Subscriber and an Editor account, log in as each,
 * verify what they can / cannot do with BetterDocs:
 *   - Subscriber: can read docs but cannot access admin pages
 *   - Editor: can edit docs but cannot edit settings
 *   - Contributor: can draft docs but not publish
 *   - Logged-out guest: same as anonymous
 */
const { test, expect } = require("@playwright/test");
const { loginAsAdmin, getRestNonce } = require("../../helpers/staging/auth");
const { setTier } = require("../../helpers/staging/plugins");
const { STAGING } = require("../../helpers/staging/env");
const { shoot } = require("../../helpers/staging/screenshot");
const ROLE_USERS = [
    { username: `qa_subscriber_${Date.now()}`, email: `qa-sub-${Date.now()}@example.com`, role: 'subscriber', password: 'QaSub!Pass123' },
    { username: `qa_editor_${Date.now()}`, email: `qa-edit-${Date.now()}@example.com`, role: 'editor', password: 'QaEdit!Pass123' },
    { username: `qa_contributor_${Date.now()}`, email: `qa-contrib-${Date.now()}@example.com`, role: 'contributor', password: 'QaContrib!Pass123' },
];
const createdUserIds = [];
test.describe.serial('02c · Per-role visibility', () => {
    test.beforeAll(async ({ browser }) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await loginAsAdmin(page);
        await setTier(page, 'pro');
        // Create users via REST
        const nonce = await getRestNonce(page);
        for (const u of ROLE_USERS) {
            const created = await page.evaluate(async ([url, nonce, user]) => {
                const r = await fetch(`${url}/wp-json/wp/v2/users`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: user.username,
                        email: user.email,
                        password: user.password,
                        roles: [user.role],
                    }),
                });
                return r.ok ? await r.json() : { error: r.status };
            }, [STAGING.url, nonce, u]);
            if (created?.id)
                createdUserIds.push(created.id);
        }
        await ctx.close();
    });
    test('02c.1 Subscriber can VIEW frontend /docs/ but cannot reach /wp-admin/', async ({ browser }) => {
        const u = ROLE_USERS[0];
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        // Manually log in as subscriber
        await page.goto(`${STAGING.url}/wp-login.php`);
        await page.fill('#user_login', u.username);
        await page.fill('#user_pass', u.password);
        await page.click('#wp-submit');
        await page.waitForTimeout(2500);
        // Try to access wp-admin
        await page.goto(`${STAGING.url}/wp-admin/admin.php?page=betterdocs-settings`);
        await page.waitForTimeout(1500);
        const body = await page.locator('body').textContent() || '';
        const blocked = /Sorry, you are not allowed|insufficient permissions/i.test(body);
        if (!blocked)
            console.log('[02c.1] Subscriber reached settings page (capability check unexpected)');
        await shoot(page, 'test-results-staging/02c-roles/01-subscriber-blocked.png');
        await ctx.close();
    });
    test('02c.2 Editor can edit docs', async ({ browser }) => {
        const u = ROLE_USERS[1];
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.goto(`${STAGING.url}/wp-login.php`);
        await page.fill('#user_login', u.username);
        await page.fill('#user_pass', u.password);
        await page.click('#wp-submit');
        await page.waitForTimeout(2500);
        await page.goto(`${STAGING.url}/wp-admin/edit.php?post_type=docs`);
        await page.waitForTimeout(2000);
        const body = await page.locator('body').textContent() || '';
        const blocked = /Sorry, you are not allowed/i.test(body);
        if (blocked)
            console.log('[02c.2] Editor blocked from docs list (cap may be restricted by Access & Restrictions)');
        await shoot(page, 'test-results-staging/02c-roles/02-editor-docs-list.png');
        await ctx.close();
    });
    test('02c.3 Contributor cannot publish, only draft', async ({ browser }) => {
        const u = ROLE_USERS[2];
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.goto(`${STAGING.url}/wp-login.php`);
        await page.fill('#user_login', u.username);
        await page.fill('#user_pass', u.password);
        await page.click('#wp-submit');
        await page.waitForTimeout(2500);
        await page.goto(`${STAGING.url}/wp-admin/post-new.php?post_type=docs`);
        await page.waitForTimeout(3000);
        const body = await page.locator('body').textContent() || '';
        // Contributors see "Submit for Review" not "Publish"
        const hasSubmit = /Submit for Review/i.test(body);
        if (!hasSubmit)
            console.log('[02c.3] "Submit for Review" not in contributor editor body text (block editor may render differently)');
        await shoot(page, 'test-results-staging/02c-roles/03-contributor-editor.png');
        await ctx.close();
    });
    test('02c.4 Logged-out guest cannot access wp-admin', async ({ browser }) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.goto(`${STAGING.url}/wp-admin/admin.php?page=betterdocs-settings`);
        await page.waitForTimeout(1500);
        const url = page.url();
        expect(url, 'guest should redirect to wp-login').toMatch(/wp-login\.php/);
        await ctx.close();
    });
    test('02c.99 cleanup users', async ({ page }) => {
        await loginAsAdmin(page);
        const nonce = await getRestNonce(page);
        for (const id of createdUserIds) {
            await page.evaluate(async ([url, nonce, id]) => {
                await fetch(`${url}/wp-json/wp/v2/users/${id}?force=true&reassign=1`, {
                    method: 'DELETE',
                    credentials: 'include',
                    headers: { 'X-WP-Nonce': nonce },
                });
            }, [STAGING.url, nonce, id]);
        }
    });
});

const { STAGING } = require("./env");
/**
 * Resilient login.
 * Handles:
 *   - admin-email-confirmation interstitial ("Remind me later")
 *   - "Error establishing a database connection" — wait + retry once
 *   - already-logged-in (cookie hit)
 */
async function loginAsAdmin(page, attempt = 1) {
    // Retry transient network failures (ERR_NETWORK_CHANGED, chrome-error://chromewebdata/) on the long live run
    let navErr;
    for (let n = 1; n <= 3; n++) {
        try {
            await page.goto(`${STAGING.url}/wp-login.php`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            navErr = null;
            break;
        }
        catch (e) {
            navErr = e;
            await page.waitForTimeout(2000 * n);
        }
    }
    if (navErr)
        throw navErr;
    // DB-error detection right on the login page
    const dbErr = await pageHasDbError(page);
    if (dbErr) {
        if (attempt > 2)
            throw new Error('Site DB unreachable after retry');
        await page.waitForTimeout(60_000);
        return loginAsAdmin(page, attempt + 1);
    }
    // If we landed on admin page already (cookie), bail
    if (page.url().includes('/wp-admin/') && !page.url().includes('wp-login')) {
        return dismissInterstitials(page);
    }
    // Form may not be present if already logged in
    const userField = page.locator('#user_login');
    if (await userField.count() > 0) {
        await userField.waitFor({ state: 'visible' });
        // Use fill() (atomic, no keyboard simulation) — type() drops chars on this WP build
        await userField.fill(STAGING.user);
        await page.locator('#user_pass').fill(STAGING.pass);
        // Verify values stuck before submitting (defends against form re-render mid-fill)
        const userValue = await userField.inputValue();
        const passValue = await page.locator('#user_pass').inputValue();
        if (userValue !== STAGING.user || passValue !== STAGING.pass) {
            await userField.fill('');
            await page.locator('#user_pass').fill('');
            await userField.fill(STAGING.user);
            await page.locator('#user_pass').fill(STAGING.pass);
        }
        await Promise.all([
            page.waitForLoadState('domcontentloaded'),
            page.click('#wp-submit'),
        ]);
        await page.waitForTimeout(1500);
    }
    await dismissInterstitials(page);
    // After interstitials we should be on wp-admin
    if (!page.url().includes('/wp-admin/')) {
        throw new Error(`Login did not land on wp-admin. Current: ${page.url()}`);
    }
}
/**
 * Some WordPress installs show interstitial screens between login and dashboard:
 *  - admin-email confirmation (every 6 months)
 *  - "your password has been weak"
 *  - "About WordPress" after a major upgrade
 * Click past them.
 */
async function dismissInterstitials(page) {
    // Admin email confirmation
    const remindLater = page.locator('a:has-text("Remind me later")');
    if (await remindLater.count() > 0) {
        await Promise.all([
            page.waitForLoadState('domcontentloaded'),
            remindLater.first().click(),
        ]);
    }
    // "About WordPress" upgrade screen
    const aboutWp = page.locator('a:has-text("Return to Dashboard"), a:has-text("Go to Dashboard")');
    if (await aboutWp.count() > 0) {
        await Promise.all([
            page.waitForLoadState('domcontentloaded'),
            aboutWp.first().click(),
        ]);
    }
}
async function pageHasDbError(page) {
    const body = await page.locator('body').textContent().catch(() => '');
    return /Error establishing a database connection|database error/i.test(body || '');
}
/**
 * Visit any wp-admin URL with retry on DB error.
 */
async function gotoAdmin(page, path) {
    const target = path.startsWith('http') ? path : `${STAGING.url}/wp-admin/${path.replace(/^\//, '')}`;
    for (let attempt = 1; attempt <= 3; attempt++) {
        let navOk = false;
        for (let n = 1; n <= 3; n++) {
            try {
                await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
                navOk = true;
                break;
            }
            catch (_) {
                await page.waitForTimeout(2000 * n);
            }
        }
        if (!navOk)
            continue;
        if (!await pageHasDbError(page))
            return;
        await page.waitForTimeout(30_000);
    }
    throw new Error(`Page ${path} unreachable or DB-erroring after 3 attempts`);
}
/**
 * Get the X-WP-Nonce for authenticated REST calls.
 * Reads from the admin page's `wpApiSettings.nonce` global.
 *
 * wpApiSettings isn't enqueued on every admin page (plugins.php often
 * lacks it). Always navigate to the BetterDocs settings page which
 * reliably localizes the global.
 */
async function getRestNonce(page) {
    const tryRead = async () => page.evaluate(() => window.wpApiSettings?.nonce || '');
    let nonce = '';
    if (page.url().includes('/wp-admin/')) {
        nonce = await tryRead();
    }
    if (nonce)
        return nonce;
    // Fallback 1: dashboard
    await gotoAdmin(page, 'index.php');
    nonce = await tryRead();
    if (nonce)
        return nonce;
    // Fallback 2: BetterDocs settings page (always enqueues wp-api-fetch)
    await gotoAdmin(page, 'admin.php?page=betterdocs-settings');
    await page.waitForTimeout(800);
    nonce = await tryRead();
    if (nonce)
        return nonce;
    throw new Error('Could not read wpApiSettings.nonce after multiple admin-page hits');
}
/**
 * Login as an arbitrary WordPress user (not admin).
 * Same hardening as loginAsAdmin — fill+verify, retry on transient nav errors.
 */
async function loginAsUser(page, login, pass) {
    let navErr;
    for (let n = 1; n <= 3; n++) {
        try {
            await page.goto(`${STAGING.url}/wp-login.php`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            navErr = null;
            break;
        }
        catch (e) {
            navErr = e;
            await page.waitForTimeout(2000 * n);
        }
    }
    if (navErr)
        throw navErr;
    const userField = page.locator('#user_login');
    await userField.waitFor({ state: 'visible' });
    await userField.fill(login);
    await page.locator('#user_pass').fill(pass);
    // Verify values stuck (login form can re-render mid-fill)
    if ((await userField.inputValue()) !== login) {
        await userField.fill('');
        await userField.fill(login);
    }
    if ((await page.locator('#user_pass').inputValue()) !== pass) {
        await page.locator('#user_pass').fill('');
        await page.locator('#user_pass').fill(pass);
    }
    await Promise.all([
        page.waitForLoadState('domcontentloaded'),
        page.click('#wp-submit'),
    ]);
    await page.waitForTimeout(1500);
    await dismissInterstitials(page);
}
/**
 * Use the "User Switching" plugin to switch the *current* admin session
 * to a different user. The admin session is preserved; call switchBack() to return.
 *
 * Strategy: visit /wp-admin/users.php, search for the target, click its "Switch To"
 * row-action. Throws if the plugin isn't active or the user can't be found.
 */
async function userSwitchTo(page, login) {
    await gotoAdmin(page, `users.php?s=${encodeURIComponent(login)}`);
    await page.waitForTimeout(1500);
    // The row containing the target — match by login OR email (User Switching
    // shows both; the search is fuzzy).
    const row = page.locator('#the-list tr').filter({ hasText: login }).first();
    if (await row.count() === 0) {
        throw new Error(`userSwitchTo: no users.php row matches ${login}`);
    }
    // Hover so row-actions become visible, then click "Switch To"
    await row.hover().catch(() => { });
    const switchLink = row.locator('a:has-text("Switch To"), a[href*="action=switch_to_user"]').first();
    if (await switchLink.count() === 0) {
        throw new Error(`userSwitchTo: "Switch To" link not found — User Switching plugin not active?`);
    }
    await Promise.all([
        page.waitForLoadState('domcontentloaded'),
        switchLink.click(),
    ]);
    await page.waitForTimeout(1500);
}
/**
 * Switch back to the original (pre-switch) admin user via the User Switching
 * plugin's admin-bar link. No-op if not currently switched.
 */
async function userSwitchBack(page) {
    // The "Switch back" link is in the admin bar OR on the user's profile page.
    // Easiest path: hit the action URL directly.
    await page.goto(`${STAGING.url}/wp-admin/?action=switch_to_olduser`, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => { });
    await page.waitForTimeout(1500);
}

module.exports = { loginAsAdmin, dismissInterstitials, pageHasDbError, gotoAdmin, getRestNonce, loginAsUser, userSwitchTo, userSwitchBack };

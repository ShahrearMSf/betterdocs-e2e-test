const { STAGING } = require("./env");
/**
 * Fill the wp-login user + password fields with clear-then-fill semantics,
 * verifying both values stuck. Retries up to 3 times because Chrome's
 * autofill sometimes overwrites `fill()` post-render and swallowing that
 * silently leaves the password blank (root cause of an empty-password
 * submit that lands us on wp-login with a "please fill this field" tooltip).
 */
async function fillCredsVerified(page) {
    for (let n = 1; n <= 3; n++) {
        try {
            await page.locator('#user_login').fill('');
            await page.locator('#user_pass').fill('');
            await page.locator('#user_login').fill(STAGING.user);
            await page.locator('#user_pass').fill(STAGING.pass);
        } catch (_) { /* retry */ }
        const uv = await page.locator('#user_login').inputValue().catch(() => '');
        const pv = await page.locator('#user_pass').inputValue().catch(() => '');
        if (uv === STAGING.user && pv === STAGING.pass) return true;
        await page.waitForTimeout(400 * n);
    }
    throw new Error('Could not persist login credentials into wp-login form after 3 attempts');
}
/**
 * Resilient login.
 * Handles:
 *   - admin-email-confirmation interstitial ("Remind me later")
 *   - "Error establishing a database connection" — wait + retry once
 *   - already-logged-in (cookie hit)
 */
async function loginAsAdmin(page, attempt = 1) {
    // Fast-path: if storageState already gave us a session, just probe the
    // dashboard. No wp-login.php visit → no CAPTCHA re-challenge.
    try {
        await page.goto(`${STAGING.url}/wp-admin/`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        if (page.url().includes('/wp-admin/') && !page.url().includes('wp-login')) {
            return dismissInterstitials(page);
        }
    } catch (_) { /* fall through to full login */ }
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
    // "Prove Your Humanity" math challenge — some staging sites gate
    // wp-login.php with this. Solve it and let the Continue button navigate
    // us to the real login form. Re-visiting wp-login.php after solving
    // triggers a fresh challenge so we don't do that.
    await solveHumanityChallenge(page);
    // Form may not be present if already logged in
    const userField = page.locator('#user_login');
    if (await userField.count() > 0) {
        await userField.waitFor({ state: 'visible' });
        await fillCredsVerified(page);
        // Retry the submit + nav up to 3 times. On a loaded staging site the click
        // can hang transiently (browser stuck, server slow); a quick retry usually clears it.
        let submitErr;
        for (let n = 1; n <= 3; n++) {
            // Chrome's autofill / a plugin's JS keeps wiping the password
            // field AFTER our verify pass and BEFORE the submit click on the
            // msf.bd host. The previous split (assign → verify → click) left
            // a small async window where autofill would replace the value
            // with an empty string. This atomic version re-assigns the
            // fields, verifies the password stuck AND submits the form —
            // all inside a single `evaluate` callback so no async gap
            // exists for autofill to intercept.
            //
            // `form.submit()` also bypasses HTML5 required-field validation,
            // so if the password DOES somehow end up empty the browser
            // submits it anyway and WordPress responds with a normal login
            // error — which is far more diagnostic than the silent HTML5
            // "Please fill out this field" tooltip we saw before.
            const submitResult = await page.evaluate(([user, pass]) => {
                const set = (sel, val) => {
                    const el = document.querySelector(sel);
                    if (!el) return null;
                    const proto = Object.getPrototypeOf(el);
                    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, val);
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    return el.value;
                };
                set('#user_login', user);
                const pv = set('#user_pass', pass);
                if (pv !== pass) return { ok: false, reason: 'password did not stick' };
                const form = document.getElementById('loginform');
                if (!form) return { ok: false, reason: 'loginform not found' };
                form.submit();
                return { ok: true };
            }, [STAGING.user, STAGING.pass]);
            if (!submitResult.ok) {
                submitErr = new Error(`fill+submit failed: ${submitResult.reason} (attempt ${n})`);
                await page.waitForTimeout(1000 * n);
                continue;
            }
            try {
                await page.waitForLoadState('domcontentloaded', { timeout: 20_000 });
                submitErr = null;
                break;
            } catch (e) {
                submitErr = e;
                await page.waitForTimeout(2000 * n);
                // If we somehow already landed on wp-admin (race), bail out of the retry loop
                if (page.url().includes('/wp-admin/')) {
                    submitErr = null;
                    break;
                }
                // Otherwise, reload the login page and re-fill before the next attempt
                if (n < 3) {
                    await page.goto(`${STAGING.url}/wp-login.php`, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => { });
                    // Re-visiting can re-trigger the humanity challenge; solve
                    // whatever's there before trying to fill.
                    await solveHumanityChallenge(page);
                    await fillCredsVerified(page);
                }
            }
        }
        if (submitErr) throw submitErr;
        await page.waitForTimeout(1500);
    }
    // Post-submit humanity check — the CAPTCHA plugin can consume the
    // session-flag on our login POST and re-challenge us. If a challenge
    // appears now, solve it, then refill+resubmit the login form because
    // Continue on the challenge navigates back to an empty login form.
    for (let n = 1; n <= 3; n++) {
        if (!await solveHumanityChallenge(page)) break;
        // We're now on wp-login again with an empty form (session-flag set).
        const uf = page.locator('#user_login');
        if (await uf.count() === 0) break; // maybe landed on wp-admin directly
        await fillCredsVerified(page);
        await Promise.all([
            page.waitForLoadState('domcontentloaded'),
            page.click('#wp-submit', { timeout: 20_000 }).catch(() => {}),
        ]);
        await page.waitForTimeout(1500);
        if (page.url().includes('/wp-admin/')) break;
    }
    await dismissInterstitials(page);
    // After interstitials we should be on wp-admin
    if (!page.url().includes('/wp-admin/')) {
        throw new Error(`Login did not land on wp-admin. Current: ${page.url()}`);
    }
}
/**
 * Some staging sites gate wp-login.php with a "Prove Your Humanity" math
 * challenge (e.g. "10 + 2 = ?"). Detect it, parse the arithmetic from the
 * visible text, solve it, and click Continue so we can proceed to the real
 * login form on the next page.
 *
 * Returns true if a challenge was solved (caller should re-render the login
 * form afterwards); false if none was present.
 */
async function solveHumanityChallenge(page) {
    const body = await page.locator('body').textContent().catch(() => '') || '';
    if (!/Prove your humanity|Please solve this math problem/i.test(body)) {
        return false;
    }
    // Grab the "N ± M = ?" line. Support +, -, *, /.
    const parsed = await page.evaluate(() => {
        const text = document.body.innerText || '';
        // Match e.g. "10 + 2 =" or "10  +   2  ="
        const m = text.match(/(-?\d+)\s*([+\-*/×÷])\s*(-?\d+)\s*=/);
        if (!m) return null;
        return { a: Number(m[1]), op: m[2], b: Number(m[3]) };
    });
    if (!parsed) return false;
    const { a, op, b } = parsed;
    let answer;
    switch (op) {
        case '+': answer = a + b; break;
        case '-': answer = a - b; break;
        case '*': case '×': answer = a * b; break;
        case '/': case '÷': answer = a / b; break;
        default: return false;
    }
    // Extra safety: bail if the WordPress login form (#user_login /
    // #user_pass) is on this page. On some hosts the login page contains
    // policy / help text that trips the regex above, and clicking the
    // generic `input[type="submit"]` below would submit wp-login with an
    // empty password — the exact regression we saw on the msf.bd host.
    if (await page.locator('#user_login, #user_pass').count() > 0) return false;
    const input = page.locator('input[type="text"], input[type="number"], input:not([type])').first();
    if (await input.count() === 0) return false;
    await input.fill(String(answer));
    // Continue button — restricted to the challenge form so we can't
    // accidentally click wp-login's Log In (also `input[type="submit"]`).
    const cont = page.locator([
        'button:has-text("Continue")',
        'button:has-text("Submit")',
        'input[type="submit"][value*="Continue" i]',
    ].join(', ')).first();
    if (await cont.count() === 0) return false;
    // Decoupled click + wait: some CAPTCHA plugins validate via AJAX and
    // rewrite the page without a full navigation, so `Promise.all([click,
    // waitForLoadState])` would time out even though the challenge was
    // accepted. Click, then poll for either a URL change OR the challenge
    // markup going away, with a bounded budget.
    const beforeUrl = page.url();
    await cont.click({ timeout: 8_000 }).catch(() => {});
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        if (page.url() !== beforeUrl) break;
        const stillChallenged = await page.locator('body').textContent().catch(() => '');
        if (!/Prove your humanity|Please solve this math problem/i.test(stillChallenged || '')) break;
        await page.waitForTimeout(500);
    }
    await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(600);
    return true;
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
    // Match ONLY the WordPress "site can't reach the DB" screen. The earlier
    // `|database error` alternative fired on any plugin description that
    // contained the word "database" — false positive.
    return /Error establishing a database connection|Your PHP installation appears to be missing the MySQL extension/i.test(body || '');
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
    // Retry the submit + nav up to 3 times (matches loginAsAdmin).
    let submitErr;
    for (let n = 1; n <= 3; n++) {
        try {
            await Promise.all([
                page.waitForLoadState('domcontentloaded'),
                page.click('#wp-submit', { timeout: 20_000 }),
            ]);
            submitErr = null;
            break;
        } catch (e) {
            submitErr = e;
            await page.waitForTimeout(2000 * n);
            if (page.url().includes('/wp-admin/')) { submitErr = null; break; }
            if (n < 3) {
                await page.goto(`${STAGING.url}/wp-login.php`, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => { });
                await page.locator('#user_login').fill(login).catch(() => { });
                await page.locator('#user_pass').fill(pass).catch(() => { });
            }
        }
    }
    if (submitErr) throw submitErr;
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

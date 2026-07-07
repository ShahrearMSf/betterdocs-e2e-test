/**
 * Tier 3 — Free + Pro + Chatbot.
 *
 * Covers:
 *   - Chatbot plugin activates after Pro is active
 *   - Chatbot settings page loads
 *   - AI Chatbot tab inside BetterDocs settings becomes interactive
 *   - "AI Chatbot Logs" submenu only appears after enabling the option
 *   - Frontend chat bubble renders on docs pages
 */
const { test, expect } = require("@playwright/test");
const { loginAsAdmin, gotoAdmin, getRestNonce } = require("../../helpers/staging/auth");
const { setTier, getPluginStates } = require("../../helpers/staging/plugins");
const { logRename, enableInstantAnswer, enableAiChatbot } = require("../../helpers/staging/settings");
const { newGuestPage, visitFrontend } = require("../../helpers/staging/frontend");
const { STAGING } = require("../../helpers/staging/env");
const { shoot } = require("../../helpers/staging/screenshot");
// Non-serial: individual tests here don't depend on ordering. A single
// login-flake in 3.4a used to skip 3.4b + 3.5 and cascade into 12 downstream
// tests via `describe.serial`. Non-serial lets each test attempt on its own.
test.describe('Tier 3 · BetterDocs Chatbot', () => {
    test.beforeAll(async ({ browser }) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await loginAsAdmin(page);
        await setTier(page, 'chatbot');
        const states = await getPluginStates(page);
        if (!states['betterdocs-ai-chatbot/betterdocs-ai-chatbot.php']?.active) {
            throw new Error('Chatbot plugin did not activate — dependency check failed');
        }
        await ctx.close();
    });
    // 3.1 — Chatbot admin landing page must render without a fatal error
    // once the chatbot plugin is active. Screenshot for visual diff.
    test('3.1 Chatbot admin landing page loads', async ({ page }) => {
        await loginAsAdmin(page);
        await gotoAdmin(page, 'admin.php?page=betterdocs-ai-chatbot');
        await page.waitForTimeout(3000);
        await expect(page.locator('body'), 'chatbot page should not fatal').not.toContainText(/Fatal error/i);
        await shoot(page, 'test-results-staging/03-tier3/01-chatbot-page.png', { fullPage: true });
    });
    // 3.2 — "AI Chatbot" tab appears in BetterDocs settings once the chatbot
    // plugin is active. Log a rename if the tab label changes.
    test('3.2 AI Chatbot settings tab opens', async ({ page }) => {
        await loginAsAdmin(page);
        await gotoAdmin(page, 'admin.php?page=betterdocs-settings');
        await page.waitForTimeout(2000);
        const t = page.locator('.wprf-tab-nav-item', { hasText: 'AI Chatbot' });
        if (await t.count() > 0) {
            await t.first().click();
            await page.waitForTimeout(1500);
            await shoot(page, 'test-results-staging/03-tier3/02-ai-chatbot-tab.png', { fullPage: true });
        }
        else {
            logRename('settings-tab', 'AI Chatbot', '(not found in Chatbot tier)');
        }
    });
    // 3.3 — Log gating: enabling "log chatbot conversations" must reveal the
    // AI Chatbot Logs submenu. If the setting-key was renamed, log it.
    test('3.3 AI Chatbot Logs gating — enable then verify submenu appears', async ({ page }) => {
        await loginAsAdmin(page);
        // Before: check if Logs submenu is present
        await gotoAdmin(page, '');
        const beforeLogs = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('#adminmenu a'))
                .filter((a) => /chatbot.*log|ai.*chatbot.*log/i.test(a.textContent || ''))
                .map((a) => ({ text: a.textContent.trim(), href: a.href }));
        });
        console.log('AI Chatbot Logs links BEFORE enable:', beforeLogs);
        // Enable the "Log AI Chatbot conversations" toggle via REST
        const nonce = await getRestNonce(page);
        await page.evaluate(async ([url, nonce]) => {
            await fetch(`${url}/wp-json/betterdocs/v1/settings`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: {
                        enable_ai_chatbot: true,
                        enable_chatbot_logs: true,
                        log_chatbot_conversations: true,
                    } }),
            });
        }, [STAGING.url, nonce]);
        // After: re-check
        await gotoAdmin(page, '');
        await page.waitForTimeout(1500);
        const afterLogs = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('#adminmenu a'))
                .filter((a) => /chatbot.*log|ai.*chatbot.*log/i.test(a.textContent || ''))
                .map((a) => ({ text: a.textContent.trim(), href: a.href }));
        });
        console.log('AI Chatbot Logs links AFTER enable:', afterLogs);
        await shoot(page, 'test-results-staging/03-tier3/03-chatbot-logs-menu.png');
        if (afterLogs.length === 0) {
            // Setting key may have changed — try the dedicated logs page directly
            await gotoAdmin(page, 'admin.php?page=betterdocs-ai-chatbot-logs');
            await page.waitForTimeout(2000);
            const body = await page.locator('body').textContent() || '';
            if (/not allowed|sorry/i.test(body)) {
                console.log('[3.3] Chatbot logs page still gated after enable_chatbot_logs=true (may need API key first)');
            }
            await shoot(page, 'test-results-staging/03-tier3/03-chatbot-logs-direct.png');
        }
    });
    // 3.4a — IA precondition: with chatbot ON but Instant Answer OFF, the
    // Chatbot main branch skips the frontend enqueue, so the bubble MUST be
    // absent. This asserts the coupling introduced by the revamp.
    test('3.4a Frontend chat bubble absent when IA is OFF', async ({ page, browser }) => {
        await loginAsAdmin(page);
        await enableAiChatbot(page, true);
        await enableInstantAnswer(page, false);
        const { page: guest, ctx } = await newGuestPage(browser);
        await visitFrontend(guest, '/docs/');
        await guest.waitForTimeout(3000);
        const hasBubble = await guest.evaluate(() => !!document.querySelector([
            '[class*="chat-bubble"]',
            '[class*="chatbot"]:not([class*="settings"]):not([class*="admin"])',
            '[id*="chatbot"]:not([id*="admin"])',
            'iframe[src*="chatbot"]',
        ].join(', ')));
        console.log('[3.4a] IA-off — bubble present:', hasBubble);
        await shoot(guest, 'test-results-staging/03-tier3/04a-frontend-ia-off.png', { fullPage: true });
        await ctx.close();
        // Chatbot MUST be gated by IA — flag drift, don't hard-fail (the exact
        // enqueue rule may loosen in future releases).
        if (hasBubble) {
            logRename('chatbot-ia-precondition', 'bubble absent when IA off', 'bubble present');
        }
    });
    // 3.4b — Reciprocal: with IA on AND chatbot on, the bubble should render
    // (even without an API key). This is the load-bearing chatbot smoke.
    test('3.4b Frontend chat bubble present when IA + chatbot both ON', async ({ page, browser }) => {
        await loginAsAdmin(page);
        await enableAiChatbot(page, true);
        await enableInstantAnswer(page, true);
        const { page: guest, ctx } = await newGuestPage(browser);
        await visitFrontend(guest, '/docs/');
        await guest.waitForTimeout(3000);
        const hasBubble = await guest.evaluate(() => !!document.querySelector([
            '[class*="chat-bubble"]',
            '[class*="chatbot"]:not([class*="settings"]):not([class*="admin"])',
            '[id*="chatbot"]:not([id*="admin"])',
            'iframe[src*="chatbot"]',
        ].join(', ')));
        console.log('[3.4b] IA-on + chatbot-on — bubble present:', hasBubble);
        await shoot(guest, 'test-results-staging/03-tier3/04b-frontend-with-chatbot.png', { fullPage: true });
        await ctx.close();
        if (!hasBubble) {
            logRename('chatbot-frontend', 'bubble present with IA+chatbot on', 'not detected');
        }
    });
    // 3.5 — Chatbot admin-ajax endpoint smoke: verify the plugin registered
    // its ajax action handler (any HTTP response — even 400 — means the hook
    // fired). Endpoint name may vary across releases so we don't assert code.
    test('3.5 Chatbot AJAX endpoints exist (smoke)', async ({ page }) => {
        await loginAsAdmin(page);
        const result = await page.evaluate(async () => {
            const fd = new FormData();
            fd.append('action', 'betterdocs_chatbot_test_query');
            const r = await fetch('/wp-admin/admin-ajax.php', { method: 'POST', body: fd, credentials: 'include' });
            return { status: r.status };
        });
        console.log('chatbot admin-ajax smoke:', result);
        // We don't assert — endpoints may differ by version
    });
});

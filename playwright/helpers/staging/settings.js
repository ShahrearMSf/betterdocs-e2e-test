const fs = require("fs");
const path = require("path");
const { gotoAdmin, getRestNonce } = require("./auth");
const { STAGING } = require("./env");
const RENAME_REPORT = path.resolve(__dirname, '../../../staging-renames-report.json');
// In-run dedup: same (scope|expected|actual) triple only writes once per
// process. Prevents the report from being 100 copies of the same drift.
const _seenRenames = new Set();
/** Append a rename observation. Never throws. Dedups within a run. */
function logRename(scope, expected, actual) {
    const key = `${scope}|${expected}|${actual}`;
    if (_seenRenames.has(key)) return;
    _seenRenames.add(key);
    let entries = [];
    if (fs.existsSync(RENAME_REPORT)) {
        try {
            entries = JSON.parse(fs.readFileSync(RENAME_REPORT, 'utf8'));
        }
        catch (_) { }
    }
    entries.push({ ts: new Date().toISOString(), scope, expected, actual });
    try {
        fs.writeFileSync(RENAME_REPORT, JSON.stringify(entries, null, 2));
    }
    catch (_) { }
}
/**
 * Click a settings tab by visible label.
 * If the label can't be found, return false (don't fail).
 */
async function clickSettingsTab(page, label) {
    const tab = page.locator('.wprf-tab-nav-item', { hasText: label });
    if (await tab.count() === 0) {
        logRename('settings-tab', label, '(not found)');
        return false;
    }
    await tab.first().click();
    await page.waitForTimeout(900);
    return true;
}
/**
 * Get visible settings tabs as labels (for inventory / rename detection).
 */
async function listSettingsTabs(page) {
    return page.evaluate(() => {
        return [...document.querySelectorAll('.wprf-tab-nav-item')]
            .filter((el) => el.offsetParent !== null)
            .map((el) => (el.textContent || '').trim());
    });
}
/**
 * Toggle the global Multiple KB switch.
 *
 * The Pro plugin has historically accepted three different REST shapes for
 * settings writes (`{ settings: {...} }`, flat-key, and admin-ajax). We try
 * all three, then verify by hitting the read endpoint. Returns whether
 * the toggle actually flipped — callers can degrade gracefully if not.
 */
async function setMultipleKb(page, on) {
    
    
    const nonce = await getRestNonce(page);
    // Shape 1: { settings: { multiple_kb } }
    // Shape 2: { multiple_kb } (flat)
    // Send both at once so whichever the plugin parses, the toggle moves.
    await page.evaluate(async ([url, nonce, value]) => {
        await fetch(`${url}/wp-json/betterdocs/v1/settings`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
            body: JSON.stringify({ settings: { multiple_kb: value }, multiple_kb: value }),
        });
    }, [STAGING.url, nonce, on]);
    // Verify
    const persisted = await page.evaluate(async ([url, nonce]) => {
        const r = await fetch(`${url}/wp-json/betterdocs/v1/settings`, {
            credentials: 'include',
            headers: { 'X-WP-Nonce': nonce },
        });
        if (!r.ok)
            return null;
        const j = await r.json();
        return j?.multiple_kb ?? j?.settings?.multiple_kb ?? null;
    }, [STAGING.url, nonce]);
    if (persisted === true || persisted === '1' || persisted === 1)
        return true;
    if (!on && (persisted === false || persisted === '0' || persisted === 0))
        return true;
    // Fallback: drive the General settings tab UI directly.
    
    await gotoAdmin(page, 'admin.php?page=betterdocs-settings');
    await page.waitForTimeout(2500);
    // Make sure we're on the General tab
    const generalTab = page.locator('.wprf-tab-nav-item', { hasText: 'General' });
    if (await generalTab.count() > 0) {
        await generalTab.first().click().catch(() => { });
        await page.waitForTimeout(1500);
    }
    // The MKB row is usually labeled "Multiple Knowledge Base" with a switch next to it.
    const row = page.locator('.wprf-form-field, .wprf-field-row, .form-field').filter({ hasText: /Multiple Knowledge Base|Multiple KB/i }).first();
    if (await row.count() > 0) {
        const toggle = row.locator('input[type="checkbox"], .wprf-switch, [role="switch"]').first();
        if (await toggle.count() > 0) {
            const isOn = await toggle.evaluate((el) => el.checked || el.getAttribute('aria-checked') === 'true').catch(() => false);
            if (isOn !== on) {
                await toggle.click({ force: true }).catch(() => { });
                await page.waitForTimeout(1000);
                // Click the Save button if there is one
                const save = page.locator('button:has-text("Save Changes"), button:has-text("Save")').first();
                if (await save.count() > 0) {
                    await save.click().catch(() => { });
                    await page.waitForTimeout(2500);
                }
            }
        }
    }
    // Re-verify
    const after = await page.evaluate(async ([url, nonce]) => {
        const r = await fetch(`${url}/wp-json/betterdocs/v1/settings`, { credentials: 'include', headers: { 'X-WP-Nonce': nonce } });
        if (!r.ok)
            return null;
        const j = await r.json();
        return j?.multiple_kb ?? j?.settings?.multiple_kb ?? null;
    }, [STAGING.url, nonce]);
    return on ? (after === true || after === '1' || after === 1) : (after === false || after === '0' || after === 0);
}
/**
 * Visit a settings tab path + screenshot.
 * Uses the hash anchor so the React app routes directly.
 */
async function visitSettingsTabByHash(page, hash) {
    await gotoAdmin(page, `admin.php?page=betterdocs-settings#/${hash}`);
    await page.waitForTimeout(1500);
}

/**
 * Generic BetterDocs settings-key setter.
 *
 * Mirrors the dual-shape REST write used by setMultipleKb (some settings
 * were historically accepted at the top level, others only under `settings`).
 * Sends both, reads back, returns whether the write persisted.
 *
 * Use for booleans, strings, and small scalars. For toggle-only convenience
 * use the wrappers below (enableInstantAnswer, enableAiChatbot, ...).
 */
async function setBetterdocsToggle(page, key, value) {
    const nonce = await getRestNonce(page);
    await page.evaluate(async ([url, nonce, k, v]) => {
        await fetch(`${url}/wp-json/betterdocs/v1/settings`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
            body: JSON.stringify({ settings: { [k]: v }, [k]: v }),
        });
    }, [STAGING.url, nonce, key, value]);
    const persisted = await page.evaluate(async ([url, nonce, k]) => {
        const r = await fetch(`${url}/wp-json/betterdocs/v1/settings`, {
            credentials: 'include',
            headers: { 'X-WP-Nonce': nonce },
        });
        if (!r.ok) return null;
        const j = await r.json();
        return j?.[k] ?? j?.settings?.[k] ?? null;
    }, [STAGING.url, nonce, key]);
    // Loose equality — REST may serialize `true` as `"1"` / `1` etc.
    if (value === true) return persisted === true || persisted === '1' || persisted === 1;
    if (value === false) return persisted === false || persisted === '0' || persisted === 0 || persisted === '' || persisted == null;
    return String(persisted ?? '') === String(value);
}
/** Instant Answer master toggle — Free plugin, setting key `enable_disable`. */
async function enableInstantAnswer(page, on) {
    return setBetterdocsToggle(page, 'enable_disable', !!on);
}
/** AI Chatbot master toggle — Chatbot plugin, setting key `enable_ai_chatbot`. */
async function enableAiChatbot(page, on) {
    return setBetterdocsToggle(page, 'enable_ai_chatbot', !!on);
}
/** Encyclopedia master toggle — Pro plugin, `enable_encyclopedia`. */
async function enableEncyclopedia(page, on, opts = {}) {
    const ok = await setBetterdocsToggle(page, 'enable_encyclopedia', !!on);
    if (on && opts.rootSlug) {
        await setBetterdocsToggle(page, 'encyclopedia_root_slug', opts.rootSlug);
    }
    return ok;
}
/** Glossaries toggle — Pro plugin, `enable_glossaries`. Powers the glossaries taxonomy. */
async function enableGlossaries(page, on) {
    return setBetterdocsToggle(page, 'enable_glossaries', !!on);
}
/**
 * Chatbot OpenAI key — empty string clears it.
 *
 * A single POST to /betterdocs/v1/settings turned out to be insufficient on
 * the current build: the AI Chatbot tab still reads the key as valid after.
 * Clear it via every persistence surface the chatbot uses:
 *   1. betterdocs_settings option (`ai_chatbot_api_key`)
 *   2. `ai_chatbot_api_key_status` cache option (invalidated so any next
 *      check re-validates the empty key and marks it invalid)
 *   3. `betterdocs/v1/api-key` (Pro/Chatbot dedicated endpoint if exposed)
 */
async function setAiChatbotApiKey(page, key) {
    const primary = await setBetterdocsToggle(page, 'ai_chatbot_api_key', key || '');
    // Try the plugin's dedicated key endpoint in parallel. Neither may exist
    // on every build; both are best-effort.
    const nonce = await getRestNonce(page);
    await page.evaluate(async ([url, nonce, key]) => {
        for (const path of [
            '/wp-json/betterdocs/v1/ai-chatbot/api-key',
            '/wp-json/betterdocs-ai-chatbot/v1/api-key',
            '/wp-json/betterdocs/v1/api-key',
        ]) {
            try {
                await fetch(`${url}${path}`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ api_key: key, ai_chatbot_api_key: key }),
                });
            } catch (_) { /* best-effort */ }
        }
        // Invalidate the cached key-status option via admin-ajax option
        // update if available. Silent-best-effort — normal users can't do
        // this, but our admin cookie can.
        try {
            const fd = new FormData();
            fd.append('action', 'betterdocs_chatbot_reset_key_status');
            fd.append('_wpnonce', nonce);
            await fetch(`${url}/wp-admin/admin-ajax.php`, {
                method: 'POST', credentials: 'include', body: fd,
            });
        } catch (_) { }
    }, [STAGING.url, nonce, key || '']);
    return primary;
}

module.exports = {
    logRename,
    clickSettingsTab,
    listSettingsTabs,
    setMultipleKb,
    visitSettingsTabByHash,
    setBetterdocsToggle,
    enableInstantAnswer,
    enableAiChatbot,
    enableEncyclopedia,
    enableGlossaries,
    setAiChatbotApiKey,
};

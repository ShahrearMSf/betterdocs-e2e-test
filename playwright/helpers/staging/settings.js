const fs = require("fs");
const path = require("path");
const { gotoAdmin, getRestNonce } = require("./auth");
const { STAGING } = require("./env");
const RENAME_REPORT = path.resolve(__dirname, '../../../staging-renames-report.json');
/** Append a rename observation. Never throws. */
function logRename(scope, expected, actual) {
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

module.exports = { logRename, clickSettingsTab, listSettingsTabs, setMultipleKb, visitSettingsTabByHash };

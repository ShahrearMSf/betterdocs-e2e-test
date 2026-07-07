/**
 * Global setup — perform a single wp-login (including CAPTCHA solve if
 * present) once at the top of the whole test run, then persist cookies +
 * localStorage to `.auth/admin.json`. Every project consumes that file via
 * `use.storageState`, so no test re-logs-in unless the cookie has expired.
 *
 * This turns ~30 s of login-per-test into ~30 s once.
 */
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
// Load .env before pulling STAGING creds — mirrors playwright.staging.config.js.
(function loadDotenv() {
    const envFile = path.resolve(__dirname, '..', '.env');
    if (!fs.existsSync(envFile)) return;
    for (const raw of fs.readFileSync(envFile, 'utf8').split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const k = line.slice(0, eq).trim();
        const v = line.slice(eq + 1).trim().replace(/^["'](.*)["']$/, '$1');
        if (!(k in process.env)) process.env[k] = v;
    }
})();
const { loginAsAdmin } = require('./helpers/staging/auth');

const AUTH_DIR = path.resolve(__dirname, '..', '.auth');
const ADMIN_STATE = path.join(AUTH_DIR, 'admin.json');

module.exports = async () => {
    if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
    const browser = await chromium.launch();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
        await loginAsAdmin(page);
        await ctx.storageState({ path: ADMIN_STATE });
        console.log(`[global-setup] admin login OK → wrote ${ADMIN_STATE}`);
    } finally {
        await browser.close();
    }
};

module.exports.ADMIN_STATE = ADMIN_STATE;

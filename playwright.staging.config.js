/**
 * Playwright config for the BetterDocs staging suite.
 *
 * Run:
 *   npx playwright test --config=playwright.staging.config.js
 *
 * Tier projects:
 *   --project=tier1-free
 *   --project=tier2-pro
 *   --project=tier3-chatbot
 *
 * All credentials and the base URL must be provided via environment
 * variables — typically loaded from a local `.env` file (see `.env.example`).
 */
const { defineConfig } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Minimal `.env` loader (no external dependency). Variables already present
// in `process.env` win over the file.
(function loadDotenv() {
    const envFile = path.resolve(__dirname, '.env');
    if ( !fs.existsSync(envFile) ) return;
    const lines = fs.readFileSync(envFile, 'utf8').split('\n');
    for ( const raw of lines ) {
        const line = raw.trim();
        if ( !line || line.startsWith('#') ) continue;
        const eq = line.indexOf('=');
        if ( eq === -1 ) continue;
        const key = line.slice(0, eq).trim();
        const val = line.slice(eq + 1).trim().replace(/^["'](.*)["']$/, '$1');
        if ( !(key in process.env) ) process.env[key] = val;
    }
})();

if ( !process.env.STAGING_URL ) {
    throw new Error('Missing STAGING_URL — set it in your environment or copy .env.example to .env');
}

module.exports = defineConfig({
    testDir: './playwright/tests/staging',
    timeout: 10 * 60_000,        // 10 min per test — accommodates slow staging server responses
    fullyParallel: false,        // tier specs share site state — serial within a tier
    workers: 1,
    retries: process.env.CI ? 2 : 0,
    reporter: [
        ['list'],
        ['html', { outputFolder: 'playwright-report-staging', open: 'never' }],
        ['json', { outputFile: 'results.json' }],
    ],
    outputDir: './test-results-staging',
    use: {
        baseURL: process.env.STAGING_URL,
        viewport: { width: 1440, height: 900 },
        actionTimeout: 15_000,
        navigationTimeout: 30_000,
        trace: 'retain-on-failure',
        video: 'retain-on-failure',
        screenshot: 'on',
        headless: process.env.HEADED ? false : true,
    },
    projects: [
        {
            name: '00-setup',
            testMatch: /00-setup\.spec\.js/,
        },
        {
            name: 'tier1-free',
            testMatch: /\/01[a-z]?-.*\.spec\.js$/,
            dependencies: ['00-setup'],
        },
        {
            name: 'tier2-pro',
            testMatch: /\/02[a-z]?-.*\.spec\.js$/,
            dependencies: ['tier1-free'],
        },
        {
            name: 'tier3-chatbot',
            testMatch: /\/03[a-z]?-.*\.spec\.js$/,
            dependencies: ['tier2-pro'],
        },
        {
            name: 'themes',
            testMatch: /04-themes-.*\.spec\.js/,
            dependencies: ['tier3-chatbot'],
        },
        {
            name: '99-cleanup',
            testMatch: /99-cleanup\.spec\.js/,
            dependencies: ['themes'],
        },
    ],
});

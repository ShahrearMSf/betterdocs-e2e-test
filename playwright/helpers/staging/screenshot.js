/**
 * Selectors for promo banners, tooltips, and notices that get in the way.
 * Each is best-effort — dismiss if present, ignore if not.
 */
const DISMISSERS = [
    // BetterDocs Pro "Spring Savings" promo
    { name: 'betterdocs-promo-banner', selector: '#betterdocs-promo-notice .notice-dismiss, .betterdocs-promo .close, [class*="betterdocs"][class*="promo"] [class*="dismiss"]' },
    { name: 'betterdocs-promo-banner-text', selector: 'a:has-text("I\'ll Grab It Later")' },
    { name: 'betterdocs-promo-strip', selector: '.spring-savings, .betterdocs-promo, .bd-promo-banner', via: 'remove' },
    // Elementor "The Editor has a new home" tooltip
    { name: 'elementor-tooltip-got-it', selector: 'button:has-text("Got it")' },
    { name: 'elementor-tooltip-dismiss', selector: '.e-onboarding__close, .e-onboarding [class*="dismiss"]' },
    { name: 'elementor-tooltip-shroud', selector: '[class*="e-onboarding"], [class*="elementor-onboarding"], [class*="introjs"]', via: 'remove' },
    // WordPress generic notice dismiss button
    { name: 'wp-notice-dismiss', selector: '.notice .notice-dismiss' },
    // WPML setup banner
    { name: 'wpml-banner', selector: '.wpml-icl-promotion-popup .icl-promotion-popup__close-btn' },
    // BetterDocs review nag
    { name: 'review-nag', selector: 'a:has-text("Maybe Later"), a:has-text("Never show again"), a:has-text("Already did")' },
    // Help Scout / Crisp chat bubble that floats on every page
    { name: 'chat-bubble', selector: '#crisp-chatbox, [id^="helpscout"], #beacon-container, .crisp-client', via: 'remove' },
    // Plugin install prompts
    { name: 'plugin-install-prompts', selector: '.notification-dialog-background, .notification-dialog-wrap', via: 'remove' },
];
const DISABLE_ANIM_AND_HIDE_NOISE_CSS = `
*, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    scroll-behavior: auto !important;
}
/* Hide any survived noise just in case */
.e-onboarding, .elementor-onboarding, .introjs-tooltip, .introjs-overlay,
[id^="betterdocs-promo"], #betterdocs-promo-notice,
[id^="helpscout"], #crisp-chatbox, .crisp-client, #beacon-container {
    display: none !important;
}
/* Caret blink in inputs */
input, textarea { caret-color: transparent !important; }
`;
async function dismissNoise(page) {
    for (const d of DISMISSERS) {
        try {
            const loc = page.locator(d.selector);
            const count = await loc.count();
            if (count === 0)
                continue;
            if (d.via === 'remove') {
                await page.evaluate((sel) => {
                    document.querySelectorAll(sel).forEach((el) => el.remove());
                }, d.selector);
            }
            else {
                // Click the first match — best effort, ignore errors
                await loc.first().click({ timeout: 1500 }).catch(() => { });
            }
        }
        catch (_) { }
    }
}
async function shoot(page, path, opts = {}) {
    const { waitFor, fullPage = true, settle = 1500, skipNetworkIdle = false, networkIdleTimeout = 15_000, } = opts;
    // 1. networkidle — allow XHR / API / images to finish
    if (!skipNetworkIdle) {
        try {
            await page.waitForLoadState('networkidle', { timeout: networkIdleTimeout });
        }
        catch (_) {
            // Best-effort
        }
    }
    // 2. Inject anti-noise CSS early so newly-rendered elements respect it
    await page.addStyleTag({ content: DISABLE_ANIM_AND_HIDE_NOISE_CSS }).catch(() => { });
    // 3. Run the dismissers — twice, because some are conditional on the first one going away
    await dismissNoise(page);
    await page.waitForTimeout(400);
    await dismissNoise(page);
    // 4. Wait for + scroll target into view
    if (waitFor) {
        try {
            const el = page.locator(waitFor).first();
            await el.waitFor({ state: 'visible', timeout: 10_000 });
            await el.scrollIntoViewIfNeeded({ timeout: 4_000 }).catch(() => { });
        }
        catch (_) {
            console.log(`[shoot] waitFor selector not visible: ${waitFor}`);
        }
    }
    else {
        // No specific target — scroll to top so the screenshot starts from the beginning
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })).catch(() => { });
    }
    // 5. Make sure every <img> finished loading (or errored)
    await page.evaluate(async () => {
        const imgs = Array.from(document.querySelectorAll('img'));
        await Promise.all(imgs.map((img) => {
            if (img.complete && img.naturalWidth > 0)
                return Promise.resolve();
            return new Promise((res) => {
                const done = () => res();
                img.addEventListener('load', done, { once: true });
                img.addEventListener('error', done, { once: true });
                setTimeout(done, 3_000);
            });
        }));
    }).catch(() => { });
    // 6. Web fonts
    await page.evaluate(async () => {
        if (document.fonts && document.fonts.ready) {
            try {
                await document.fonts.ready;
            }
            catch (_) { }
        }
    }).catch(() => { });
    // 7. Wait for any "Loading…" / spinner indicators to disappear
    const spinnerSelectors = [
        '.spinner.is-active', '.wprf-loading', '[class*="loading"][class*="spinner"]',
        '.betterdocs-loading', '.bd-loading',
    ];
    for (const sel of spinnerSelectors) {
        try {
            await page.locator(sel).first().waitFor({ state: 'hidden', timeout: 5_000 });
        }
        catch (_) { }
    }
    // 8. Final settle for React re-renders
    await page.waitForTimeout(settle);
    // 9. Capture
    await page.screenshot({ path, fullPage });
}

module.exports = { shoot };

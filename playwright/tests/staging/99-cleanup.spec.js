var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
/**
 * 99-cleanup — nuke any orphaned QA entities + leave the site clean.
 *
 * Each tier spec already deletes its own creates inline. This spec is the
 * defensive net for orphans if a tier failed mid-run.
 */
const { test } = require("@playwright/test");
const { loginAsAdmin } = require("../../helpers/staging/auth");
const { setTier, deactivatePlugins } = require("../../helpers/staging/plugins");
const { setMultipleKb } = require("../../helpers/staging/settings");
test.describe.serial('Cleanup', () => {
    test('Nuke QA-* posts and taxonomies', async ({ page }) => {
        await loginAsAdmin(page);
        // Need Pro on for some endpoints
        await setTier(page, 'pro');
        // Nuke docs/faqs/glossaries with QA in title
        const types = ['docs', 'betterdocs_faq', 'glossaries'];
        for (const t of types) {
            const { getRestNonce } = await Promise.resolve().then(() => __importStar(require('../../helpers/staging/auth')));
            const { STAGING } = await Promise.resolve().then(() => __importStar(require('../../helpers/staging/env')));
            const nonce = await getRestNonce(page);
            const items = await page.evaluate(async ([url, nonce, type]) => {
                const r = await fetch(`${url}/wp-json/wp/v2/${type}?search=QA&per_page=100&_fields=id`, {
                    credentials: 'include',
                    headers: { 'X-WP-Nonce': nonce },
                });
                if (!r.ok)
                    return [];
                return await r.json();
            }, [STAGING.url, nonce, t]);
            if (!Array.isArray(items))
                continue;
            for (const item of items) {
                await page.evaluate(async ([url, nonce, type, id]) => {
                    await fetch(`${url}/wp-json/wp/v2/${type}/${id}?force=true`, {
                        method: 'DELETE',
                        credentials: 'include',
                        headers: { 'X-WP-Nonce': nonce },
                    });
                }, [STAGING.url, nonce, t, item.id]);
            }
            console.log(`Cleaned ${items.length} from ${t}`);
        }
    });
    test('Disable Multiple KB toggle', async ({ page }) => {
        await loginAsAdmin(page);
        await setMultipleKb(page, false);
    });
    test('Deactivate all plugins (return to clean baseline)', async ({ page }) => {
        await loginAsAdmin(page);
        const { PLUGINS } = await Promise.resolve().then(() => __importStar(require('../../helpers/staging/env')));
        const allSlugs = Object.values(PLUGINS);
        await deactivatePlugins(page, allSlugs);
    });
});

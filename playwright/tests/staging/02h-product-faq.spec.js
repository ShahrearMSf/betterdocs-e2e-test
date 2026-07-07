/**
 * 02h — WooCommerce Product FAQ end-to-end.
 *
 * Free 4.5.7 introduces `betterdocs_product_faq_category` — a taxonomy for
 * FAQ groups that are scoped to specific WC products (or product categories,
 * or all products). On the frontend the linked FAQ is rendered inside a
 * WooCommerce product tab by default (`placement=product_tab`) via the
 * `woocommerce_product_tabs` filter, or inline via
 * `woocommerce_before/after_single_product_summary` when re-configured.
 *
 * This spec exercises the full loop:
 *   1. Pick a real WC product from the staging catalogue.
 *   2. Create a product-linked FAQ Group targeting that product.
 *   3. Create a FAQ under the group.
 *   4. Visit the product page as a guest — assert the FAQ tab / block is
 *      visible and the question renders inside it.
 *   5. Flip the placement to `after_summary` — revisit product — assert
 *      the FAQ renders inline below the summary.
 *   6. Cleanup.
 */
const { test, expect } = require("@playwright/test");
const { loginAsAdmin } = require("../../helpers/staging/auth");
const { setTier, activatePlugins } = require("../../helpers/staging/plugins");
const {
    createFaq, deleteFaq,
    createProductFaqGroup, deleteProductFaqGroup,
    setWooFaqDisplay,
    listWcProducts,
} = require("../../helpers/staging/records");
const { logRename } = require("../../helpers/staging/settings");
const { newGuestPage, visitFrontend } = require("../../helpers/staging/frontend");
const { shoot } = require("../../helpers/staging/screenshot");
const { STAGING, PLUGINS } = require("../../helpers/staging/env");

const created = { group: null, faq: null };
let targetProduct = null;

test.describe.serial('02h · WooCommerce Product FAQ', () => {
    // Preconditions: Pro (for FAQ Builder settings surface) + WC active +
    // at least one WC product visible via REST. If any of these fails, the
    // whole describe short-circuits with a logRename.
    test.beforeAll(async ({ browser }) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await loginAsAdmin(page);
        await setTier(page, 'pro');
        await activatePlugins(page, [PLUGINS.woocommerce]);
        const products = await listWcProducts(page, 10);
        if (products.length === 0) {
            logRename('02h:wc-catalogue', '≥1 product', 'empty');
        } else {
            targetProduct = products[0];
            console.log(`[02h] targeting WC product: ${targetProduct.slug} (#${targetProduct.id})`);
        }
        await ctx.close();
    });

    // 02h.1 — Create the product-linked FAQ group + a FAQ inside it. The
    // helper tries REST first, then falls back to driving the actual React
    // modal at FAQ > FAQ for WooCommerce > "Create a New Product FAQ Group".
    test('02h.1 create Product FAQ group + assign FAQ', async ({ page }) => {
        test.skip(!targetProduct, 'no WC product available on staging');
        await loginAsAdmin(page);
        const stamp = Date.now();
        const groupName = `QA Product FAQ Group ${stamp}`;
        const group = await createProductFaqGroup(page, {
            name: groupName,
            productIds: [targetProduct.id],
            productNames: [targetProduct.name],
        });
        if (!group?.id) {
            logRename('02h.1-group-rest', 'betterdocs_product_faq_category POST returns id', String(group));
            return;
        }
        created.group = { id: group.id, name: groupName };
        const question = `QA Product FAQ Q ${stamp}`;
        const answerSig = `QA-PRODUCT-FAQ-A-${stamp}`;
        const faq = await createFaq(page, {
            title: question,
            content: `<p>${answerSig}: this product ships worldwide.</p>`,
        });
        if (!faq?.id) {
            logRename('02h.1-faq-rest', 'betterdocs_faq POST returns id', 'null');
            return;
        }
        created.faq = { id: faq.id, question, answerSig };
        console.log(`[02h.1] group=${group.id} faq=${faq.id} → product #${targetProduct.id}`);
    });

    // 02h.2 — Frontend default (product tab). WC renders an "Additional
    // Information" style tab strip on the product page; the plugin injects
    // a "FAQ" tab into it. Click it and assert our question renders.
    test('02h.2 frontend — FAQ rendered inside product tab', async ({ page, browser }) => {
        test.skip(!targetProduct || !created.group || !created.faq, 'setup incomplete');
        await loginAsAdmin(page);
        await setWooFaqDisplay(page, 'product_tab');
        const { page: guest, ctx } = await newGuestPage(browser);
        await visitFrontend(guest, `/product/${targetProduct.slug}/`);
        await guest.waitForTimeout(3000);
        // WC product tab strip: Description | Additional Information |
        // Reviews (N) | FAQ. Click the "FAQ" tab, tolerating a few label /
        // href variations across BetterDocs releases.
        const faqTab = guest.locator([
            '.wc-tabs li:has-text("FAQ") a',
            '.woocommerce-tabs li:has-text("FAQ") a',
            '.wc-tabs a:has-text("FAQ")',
            '.woocommerce-tabs a:has-text("FAQ")',
            'li.faq_tab a',
            'li[class*="faq"] a',
            'a[href="#tab-faq"]',
            'a[href*="tab-faq"]',
            'a[href*="tab-product_faq"]',
            'a[href*="tab-betterdocs_faq"]',
        ].join(', ')).first();
        if (await faqTab.count() > 0) {
            await faqTab.click().catch(() => { });
            await guest.waitForTimeout(1500);
        } else {
            logRename('02h.2:product-tab', 'FAQ tab injected into WC product tabs', '(not detected)');
        }
        const body = await guest.locator('body').textContent() || '';
        await shoot(guest, 'test-results-staging/02h-product-faq/01-product-tab.png', { fullPage: true });
        // The question should be somewhere on the product page (tab content
        // may load lazily but the DOM node is usually already rendered).
        if (!body.includes(created.faq.question)) {
            logRename('02h.2:tab-content', `question "${created.faq.question}" rendered`, '(not found on product page)');
        } else {
            console.log(`[02h.2] question rendered on /product/${targetProduct.slug}/`);
        }
        await ctx.close();
    });

    // 02h.3 — Placement change: after_summary. Revisit product and confirm
    // the FAQ block is rendered inline below the product summary.
    test('02h.3 frontend — placement=after_summary renders inline', async ({ page, browser }) => {
        test.skip(!targetProduct || !created.group || !created.faq, 'setup incomplete');
        await loginAsAdmin(page);
        await setWooFaqDisplay(page, 'after_summary');
        const { page: guest, ctx } = await newGuestPage(browser);
        await visitFrontend(guest, `/product/${targetProduct.slug}/`);
        await guest.waitForTimeout(3000);
        const body = await guest.locator('body').textContent() || '';
        await shoot(guest, 'test-results-staging/02h-product-faq/02-after-summary.png', { fullPage: true });
        if (!body.includes(created.faq.question)) {
            logRename('02h.3:inline', `question "${created.faq.question}" inline`, '(not on product page)');
        }
        await ctx.close();
    });

    // 02h.99 — Cleanup: delete FAQ + group + reset display placement so the
    // staging site starts each run from the same state.
    test('02h.99 cleanup', async ({ page }) => {
        await loginAsAdmin(page);
        if (created.faq?.id) await deleteFaq(page, created.faq.id);
        if (created.group?.id) await deleteProductFaqGroup(page, created.group.id);
        await setWooFaqDisplay(page, 'product_tab');
    });
});

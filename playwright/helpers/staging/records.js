const { STAGING } = require("./env");
const { getRestNonce, gotoAdmin } = require("./auth");
async function rest(page, path, args = {}) {
    const nonce = args.nonce ?? await getRestNonce(page);
    return page.evaluate(async ([p, nonce, args]) => {
        const r = await fetch(p, {
            method: args.method || 'GET',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'X-WP-Nonce': nonce,
            },
            body: args.body ? JSON.stringify(args.body) : undefined,
        });
        const status = r.status;
        let json = null;
        try {
            json = await r.json();
        }
        catch (_) { }
        return { status, json };
    }, [`${STAGING.url}${path}`, nonce, args]);
}
// ───── docs ─────
async function createDoc(page, args) {
    const { json } = await rest(page, '/wp-json/wp/v2/docs', {
        method: 'POST',
        body: {
            title: args.title,
            content: args.content || `<p>QA seed content for ${args.title}</p>`,
            status: args.status || 'publish',
            doc_category: args.categories || [],
            doc_tag: args.tags || [],
        },
    });
    return json;
}
async function deleteDoc(page, id) {
    await rest(page, `/wp-json/wp/v2/docs/${id}?force=true`, { method: 'DELETE' });
}
// ───── categories ─────
async function createDocCategory(page, name, args = {}) {
    // First try with KB linkage if supplied. If the REST shape rejects that,
    // fall back to a plain category create (still useful for A&R-by-category
    // testing). If REST itself is unhappy, fall back to the admin Add-Term form.
    if (args.kb) {
        const { json, status } = await rest(page, '/wp-json/wp/v2/doc_category', {
            method: 'POST',
            body: { name, knowledge_base: [args.kb] },
        });
        if (json?.id)
            return json;
        if (status < 500) {
            // 4xx — likely shape mismatch; retry without `knowledge_base`.
        }
    }
    const plain = await rest(page, '/wp-json/wp/v2/doc_category', {
        method: 'POST',
        body: { name },
    });
    if (plain.json?.id)
        return plain.json;
    // Admin-UI fallback
    
    await gotoAdmin(page, 'edit-tags.php?taxonomy=doc_category&post_type=docs');
    await page.waitForTimeout(800);
    const nameInput = page.locator('#tag-name');
    if (await nameInput.count() === 0)
        return null;
    await nameInput.fill(name);
    await Promise.all([
        page.waitForLoadState('domcontentloaded'),
        page.locator('#submit').click(),
    ]);
    await page.waitForTimeout(800);
    const row = page.locator(`#the-list tr:has-text("${name}")`).first();
    if (await row.count() === 0)
        return null;
    const rowId = await row.getAttribute('id');
    const numericId = rowId?.match(/\d+/)?.[0];
    return numericId ? { id: Number(numericId), name } : null;
}
async function deleteDocCategory(page, id) {
    await rest(page, `/wp-json/wp/v2/doc_category/${id}?force=true`, { method: 'DELETE' });
}
// ───── tags ─────
async function createDocTag(page, name) {
    const { json } = await rest(page, '/wp-json/wp/v2/doc_tag', {
        method: 'POST',
        body: { name },
    });
    return json;
}
async function deleteDocTag(page, id) {
    await rest(page, `/wp-json/wp/v2/doc_tag/${id}?force=true`, { method: 'DELETE' });
}
// ───── multiple KB ─────
async function createKB(page, name) {
    // Try REST first.
    const { json } = await rest(page, '/wp-json/wp/v2/knowledge_base', {
        method: 'POST',
        body: { name },
    });
    if (json?.id)
        return json;
    // Fallback: WP-admin add-term form (works even if REST routes aren't registered).
    
    await gotoAdmin(page, 'edit-tags.php?taxonomy=knowledge_base&post_type=docs');
    await page.waitForTimeout(800);
    const nameInput = page.locator('#tag-name');
    if (await nameInput.count() === 0)
        return null;
    await nameInput.fill(name);
    await Promise.all([
        page.waitForLoadState('domcontentloaded'),
        page.locator('#submit').click(),
    ]);
    await page.waitForTimeout(800);
    // Read the new term id from the row that just appeared
    const row = page.locator(`#the-list tr:has-text("${name}")`).first();
    if (await row.count() === 0)
        return { id: null, name };
    const id = await row.getAttribute('id');
    const numericId = id?.match(/\d+/)?.[0];
    return { id: numericId ? Number(numericId) : null, name };
}
async function deleteKB(page, id) {
    await rest(page, `/wp-json/wp/v2/knowledge_base/${id}?force=true`, { method: 'DELETE' });
}
// ───── faqs ─────
async function createFaq(page, args) {
    const { json } = await rest(page, '/wp-json/wp/v2/betterdocs_faq', {
        method: 'POST',
        body: {
            title: args.title,
            content: args.content || `<p>QA FAQ answer for ${args.title}</p>`,
            status: 'publish',
            ...(args.faqCategory ? { betterdocs_faq_category: [args.faqCategory] } : {}),
        },
    });
    return json;
}
async function deleteFaq(page, id) {
    await rest(page, `/wp-json/wp/v2/betterdocs_faq/${id}?force=true`, { method: 'DELETE' });
}
// ───── glossaries (custom REST namespace on free plugin) ─────
async function createGlossary(page, args) {
    // Glossary uses a custom taxonomy + post type; try wp/v2 namespace
    const { json, status } = await rest(page, '/wp-json/wp/v2/glossaries', {
        method: 'POST',
        body: {
            title: args.title,
            content: args.content || `<p>QA glossary definition for ${args.title}</p>`,
            status: 'publish',
        },
    });
    if (status >= 400)
        return null;
    return json;
}
async function deleteGlossary(page, id) {
    await rest(page, `/wp-json/wp/v2/glossaries/${id}?force=true`, { method: 'DELETE' });
}
// ───── bulk cleanup ─────
async function nukeAllByPostType(page, postType) {
    const { json } = await rest(page, `/wp-json/wp/v2/${postType}?per_page=100&_fields=id`);
    if (!Array.isArray(json))
        return 0;
    for (const item of json) {
        await rest(page, `/wp-json/wp/v2/${postType}/${item.id}?force=true`, { method: 'DELETE' });
    }
    return json.length;
}

// ───── WooCommerce products ─────
/**
 * List WC products via WP REST. Prefers WC's own /wc/v3 (admin cookie auth),
 * falls back to /wp/v2/product (public post-type endpoint).
 */
async function listWcProducts(page, limit = 20) {
    const wc = await rest(page, `/wp-json/wc/v3/products?per_page=${limit}`);
    if (Array.isArray(wc.json) && wc.json.length) {
        return wc.json.map((p) => ({ id: p.id, name: p.name, slug: p.slug }));
    }
    const wp = await rest(page, `/wp-json/wp/v2/product?per_page=${limit}&_fields=id,slug,title`);
    if (Array.isArray(wp.json)) {
        return wp.json.map((p) => ({ id: p.id, name: p.title?.rendered || p.slug, slug: p.slug }));
    }
    return [];
}

// ───── Product FAQ Groups (WooCommerce) ─────
// Taxonomy: `betterdocs_product_faq_category` (Free ≥ 4.5).
// Term meta the plugin looks for:
//   _betterdocs_faq_group_products      — array of WC product IDs
//   _betterdocs_faq_group_product_cats  — array of product_cat term IDs
//   _betterdocs_faq_group_all_products  — bool (assign to every product)
async function createProductFaqGroup(page, args) {
    // First try public REST — fast path when show_in_rest is on.
    const { json, status } = await rest(page, '/wp-json/wp/v2/betterdocs_product_faq_category', {
        method: 'POST',
        body: {
            name: args.name,
            description: args.description || '',
            meta: {
                _betterdocs_faq_group_products: args.productIds || [],
                _betterdocs_faq_group_product_cats: args.productCatIds || [],
                _betterdocs_faq_group_all_products: args.allProducts ? 1 : 0,
            },
        },
    });
    if (json?.id) return json;
    // REST refused. On Free 4.5.7+ the taxonomy isn't `show_in_rest=true`;
    // the term must be inserted via the plugin's own admin-ajax insert.
    // Fallback: drive the React modal at the FAQ Builder WooCommerce sub-tab.
    console.log(`[createProductFaqGroup] REST returned ${status}; trying plugin REST namespaces`);
    const nonce = await getRestNonce(page);
    const inserted = await page.evaluate(async ([url, nonce, name, productIds, productCatIds, allProducts]) => {
        // Try the plugin's own REST namespaces — different releases route
        // the FAQ Builder create endpoint differently.
        for (const path of [
            '/wp-json/betterdocs/v1/faq-builder/product-groups',
            '/wp-json/betterdocs/v1/faq-builder/groups',
            '/wp-json/betterdocs-pro/v1/faq-builder/groups',
        ]) {
            try {
                const r = await fetch(`${url}${path}`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name, is_woo: true,
                        products: productIds, product_categories: productCatIds,
                        assign_to_all_products: !!allProducts,
                    }),
                });
                if (r.ok) return await r.json();
            } catch (_) { /* try next */ }
        }
        return null;
    }, [STAGING.url, nonce, args.name, args.productIds || [], args.productCatIds || [], !!args.allProducts]);
    if (inserted?.id || inserted?.term_id) {
        return { id: inserted.id || inserted.term_id, name: args.name };
    }
    // Final fallback: drive the React modal at the FAQ Builder WooCommerce
    // sub-tab. This mirrors what a real user does:
    //   FAQ → FAQ for WooCommerce → Create a New Product FAQ Group →
    //   fill name → pick product / product-category → Create.
    const modalOk = await createProductFaqGroupViaModal(page, args);
    if (modalOk?.id) return modalOk;
    return null;
}
/**
 * Drive the "Create a New Product FAQ Group" React modal.
 *
 * URL: /wp-admin/admin.php?page=betterdocs-faq&faq_tab=woocommerce&faq_subtab=groups
 * Flow: click the create button → modal opens → fill Group Name →
 *       either pick a Product (react-select) OR a Product Category →
 *       click Create / Save.
 *
 * Returns { id, name } on success (id discovered by re-listing groups),
 * null on failure. Best-effort selectors — different release cycles ship
 * different DOM shapes, so we try several before logging a rename.
 */
async function createProductFaqGroupViaModal(page, args) {
    await gotoAdmin(page, 'admin.php?page=betterdocs-faq&faq_tab=woocommerce&faq_subtab=groups');
    await page.waitForTimeout(3500);
    // Open the modal.
    const createBtn = page.locator([
        'button:has-text("Create a New Product FAQ Group")',
        'button:has-text("Create Product FAQ Group")',
        'button:has-text("Create New Group")',
        'button:has-text("Create Group")',
        'button:has-text("New Group")',
        'button:has-text("Add New")',
        'a:has-text("Create a New Product FAQ Group")',
    ].join(', ')).first();
    if (await createBtn.count() === 0) {
        console.log('[createProductFaqGroupViaModal] "Create" button not found on Product FAQ groups page');
        return null;
    }
    await createBtn.click().catch(() => {});
    await page.waitForTimeout(1500);
    // Fill the Group Name / Title input inside the modal.
    const nameInput = page.locator([
        'input[name="name"]',
        'input[name="title"]',
        'input[placeholder*="Group" i]',
        'input[placeholder*="Name" i]',
        '.bd-modal input[type="text"]',
        '[role="dialog"] input[type="text"]',
    ].join(', ')).first();
    if (await nameInput.count() === 0) {
        console.log('[createProductFaqGroupViaModal] Group Name input not found in modal');
        return null;
    }
    await nameInput.fill(args.name);
    // Pick either a product-category or a product depending on args.
    // The plugin uses react-select for both — click the control, then click
    // the option in the dropdown.
    async function pickReactSelect(hint, value) {
        const control = page.locator([
            `.bd-woo-assign-select:has-text("${hint}")`,
            `.bd-faq-select:has-text("${hint}")`,
            `label:has-text("${hint}") + * [class*="react-select"] [class*="control"]`,
            `[class*="react-select"] [class*="control"]`,
        ].join(', ')).first();
        if (await control.count() === 0) return false;
        await control.click().catch(() => {});
        await page.waitForTimeout(700);
        const option = page.locator([
            `[class*="react-select"] [class*="option"]:has-text("${value}")`,
            `[role="option"]:has-text("${value}")`,
        ].join(', ')).first();
        if (await option.count() === 0) {
            // Fall back to typing the value + hitting Enter.
            await page.keyboard.type(value, { delay: 30 });
            await page.waitForTimeout(700);
            await page.keyboard.press('Enter');
            return true;
        }
        await option.click().catch(() => {});
        return true;
    }
    if (args.productCatIds?.length || args.productCategoryNames?.length) {
        const val = args.productCategoryNames?.[0] || String(args.productCatIds[0]);
        await pickReactSelect('Product Categories', val);
    } else if (args.productIds?.length || args.productNames?.length) {
        const val = args.productNames?.[0] || String(args.productIds[0]);
        await pickReactSelect('Products', val);
    }
    // Submit.
    const submit = page.locator([
        'button:has-text("Create Group")',
        'button:has-text("Create")',
        'button:has-text("Save")',
        'button[type="submit"]',
    ].join(', ')).first();
    if (await submit.count() === 0) return null;
    await submit.click().catch(() => {});
    await page.waitForTimeout(2500);
    // Discover the term ID by re-reading the group list. Terms often expose
    // themselves via `wp/v2/betterdocs_product_faq_category` GET even when
    // POST is blocked (server-side term-list is exposed for the React app).
    const { json } = await rest(page, `/wp-json/wp/v2/betterdocs_product_faq_category?search=${encodeURIComponent(args.name)}&per_page=5`);
    if (Array.isArray(json) && json[0]?.id) return { id: json[0].id, name: args.name };
    // Fallback: read from admin-ajax listing endpoint.
    const listed = await page.evaluate(async ([url, name]) => {
        const res = await fetch(`${url}/wp-json/wp/v2/betterdocs_product_faq_category?search=${encodeURIComponent(name)}&per_page=5`, {
            credentials: 'include',
        });
        if (!res.ok) return null;
        const arr = await res.json();
        return Array.isArray(arr) && arr[0] ? arr[0].id : null;
    }, [STAGING.url, args.name]);
    if (listed) return { id: listed, name: args.name };
    return null;
}
async function deleteProductFaqGroup(page, id) {
    await rest(page, `/wp-json/wp/v2/betterdocs_product_faq_category/${id}?force=true`, { method: 'DELETE' });
}
/**
 * Set the frontend placement for Product FAQs on WC product pages.
 * placement: 'product_tab' | 'before_summary' | 'after_summary'
 */
async function setWooFaqDisplay(page, placement) {
    const { json } = await rest(page, '/wp-json/betterdocs/v1/woo-product-faq/display-settings', {
        method: 'POST',
        body: { placement, enable: true },
    });
    return json;
}

module.exports = {
    createDoc, deleteDoc,
    createDocCategory, deleteDocCategory,
    createDocTag, deleteDocTag,
    createKB, deleteKB,
    createFaq, deleteFaq,
    createGlossary, deleteGlossary,
    nukeAllByPostType,
    listWcProducts,
    createProductFaqGroup, deleteProductFaqGroup, setWooFaqDisplay,
};

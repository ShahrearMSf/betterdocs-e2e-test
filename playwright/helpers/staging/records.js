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
const { STAGING } = require("./env");
const { getRestNonce } = require("./auth");
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
    const { gotoAdmin } = await Promise.resolve().then(() => __importStar(require('./auth')));
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
    const { gotoAdmin } = await Promise.resolve().then(() => __importStar(require('./auth')));
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

module.exports = { createDoc, deleteDoc, createDocCategory, deleteDocCategory, createDocTag, deleteDocTag, createKB, deleteKB, createFaq, deleteFaq, createGlossary, deleteGlossary, nukeAllByPostType };

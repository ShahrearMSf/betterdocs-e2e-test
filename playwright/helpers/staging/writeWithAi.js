/**
 * BetterDocs "Write with AI" + "Edit with BetterDocs AI" helpers.
 *
 * The Free 4.5.x revamp rebuilt these as React bundles inside the doc
 * editor. The new modal has:
 *   - Prompt / From source / From Git tabs
 *   - a read-only model pill (uses the model set in AI settings)
 *   - a suggestions panel (categories & tags only — glossaries removed)
 *   - Keep & insert action that seeds the block editor
 *
 * Timings: OpenAI generation takes 20–40s; use generous waits. Guard AI
 * assertions on `hasApiKey(page)` so CI can still run non-generation tests.
 */
const { STAGING } = require("./env");

/** Is a valid OpenAI API key configured on this site? */
async function hasApiKey(page) {
    const res = await page.evaluate(async (url) => {
        try {
            const r = await fetch(`${url}/wp-json/betterdocs/v1/settings`, {
                credentials: 'include',
            });
            if (!r.ok) return false;
            const j = await r.json();
            const key = j?.betterdocs_api_key
                     ?? j?.settings?.betterdocs_api_key
                     ?? j?.ai_chatbot_api_key
                     ?? j?.settings?.ai_chatbot_api_key
                     ?? '';
            return typeof key === 'string' && key.length > 10;
        } catch (_) { return false; }
    }, STAGING.url);
    return !!res;
}

/**
 * Click the "Write with AI" toolbar button in the doc editor and wait
 * for the modal to render. Returns true if the modal is visible.
 */
async function openWriteWithAi(page) {
    // Button lives in the editor toolbar. Slug + text varied across
    // releases; try the canonical hook + a few text-based fallbacks.
    const trigger = page.locator([
        '.bd-write-with-ai-button',
        'button:has-text("Write with AI")',
        'button:has-text("Write with BetterDocs AI")',
        'button:has-text("BetterDocs AI")',
        '[aria-label*="Write with AI" i]',
    ].join(', ')).first();
    if (await trigger.count() === 0) return false;
    await trigger.click({ timeout: 6_000 }).catch(() => {});
    // Modal marker — dialog / class starting with bd- or betterdocs-.
    const modal = page.locator([
        '[role="dialog"]:has-text("Write with AI")',
        '[role="dialog"]:has-text("Write with BetterDocs AI")',
        '.bd-write-with-ai-modal',
        '.bd-ai-modal',
    ].join(', ')).first();
    try {
        await modal.waitFor({ state: 'visible', timeout: 8_000 });
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * Drive the generate flow. `opts.tab` is 'prompt' | 'source' | 'git';
 * `opts.prompt` for prompt-tab; `opts.url` for source/git URL fields.
 * Waits generously for the API round-trip (up to 60s).
 */
async function generate(page, opts) {
    const { tab = 'prompt', prompt, url } = opts;
    const tabLabels = {
        prompt: ['Prompt'],
        source: ['From source', 'Source', 'From URL'],
        git: ['From Git', 'Git'],
    };
    if (tab && tabLabels[tab]) {
        for (const label of tabLabels[tab]) {
            const t = page.locator(`[role="tab"]:has-text("${label}"), button:has-text("${label}")`).first();
            if (await t.count() > 0) {
                await t.click().catch(() => {});
                await page.waitForTimeout(600);
                break;
            }
        }
    }
    if (tab === 'prompt' && prompt) {
        const input = page.locator([
            'textarea[placeholder*="prompt" i]',
            'textarea[placeholder*="what" i]',
            'textarea[placeholder*="describe" i]',
            '.bd-ai-modal textarea',
            '[role="dialog"] textarea',
        ].join(', ')).first();
        if (await input.count() > 0) await input.fill(prompt);
    }
    if ((tab === 'source' || tab === 'git') && url) {
        const urlInput = page.locator([
            'input[placeholder*="URL" i]',
            'input[type="url"]',
            '.bd-ai-modal input[type="text"]',
        ].join(', ')).first();
        if (await urlInput.count() > 0) await urlInput.fill(url);
    }
    const submit = page.locator([
        'button:has-text("Generate")',
        'button:has-text("Expand")',
        'button:has-text("Continue")',
    ].join(', ')).first();
    if (await submit.count() === 0) return { ok: false, error: 'no submit button in modal' };
    await submit.click().catch(() => {});
    // Wait for either a completion marker (preview / accept button) or a
    // visible error, whichever lands first. gpt-5 can hit 40s.
    const done = page.locator([
        'button:has-text("Keep & insert")',
        'button:has-text("Insert")',
        'button:has-text("Accept")',
        '[class*="preview"]',
        '[role="alert"]',
    ].join(', ')).first();
    try {
        await done.first().waitFor({ state: 'visible', timeout: 60_000 });
        return { ok: true };
    } catch (e) {
        return { ok: false, error: 'timeout waiting for generation to finish' };
    }
}

/**
 * After a generation finishes, the preview surface shows a "Suggested
 * categories & tags" panel with chip toggles. Pick the first candidate
 * whose label matches (or the first of each group when no name given).
 */
async function pickSuggestions(page, opts = {}) {
    const clicked = { categories: [], tags: [] };
    async function clickChip(group, hint) {
        const container = page.locator([
            `[class*="suggested"]:has-text("${group}")`,
            `section:has-text("${group}")`,
            `[data-testid*="${group.toLowerCase()}"]`,
        ].join(', ')).first();
        if (await container.count() === 0) return null;
        const chip = hint
            ? container.locator(`button:has-text("${hint}"), [role="option"]:has-text("${hint}"), label:has-text("${hint}")`).first()
            : container.locator('button, [role="option"], label').first();
        if (await chip.count() === 0) return null;
        const label = (await chip.textContent())?.trim() ?? '';
        await chip.click().catch(() => {});
        return label;
    }
    const cat = await clickChip('Categories', opts.cat);
    if (cat) clicked.categories.push(cat);
    const tag = await clickChip('Tags', opts.tag);
    if (tag) clicked.tags.push(tag);
    return clicked;
}

/**
 * Click "Keep & insert" (or the closest accept button) to commit the
 * generated content into the doc editor.
 */
async function keepAndInsert(page) {
    const btn = page.locator([
        'button:has-text("Keep & insert")',
        'button:has-text("Keep and insert")',
        'button:has-text("Insert")',
        'button:has-text("Accept")',
    ].join(', ')).first();
    if (await btn.count() === 0) return false;
    await btn.click().catch(() => {});
    await page.waitForTimeout(2500);
    return true;
}

/**
 * Presence check for the (removed) Glossaries toggle inside the Write
 * with AI modal / advanced-settings drawer. Should return false — the
 * feature was intentionally removed in this revamp.
 */
async function hasGlossaryToggle(page) {
    const c = await page.locator([
        '[role="dialog"] label:has-text("Glossary")',
        '[role="dialog"] label:has-text("Glossaries")',
        '.bd-ai-modal :has-text("Glossary")',
        '.bd-ai-modal :has-text("Glossaries")',
    ].join(', ')).count();
    return c > 0;
}

/**
 * Read the "model in use" pill from the modal header. Returns the visible
 * text, or empty string if not found.
 */
async function getModelPill(page) {
    const pill = page.locator([
        '.bd-ai-modal [class*="model"]',
        '[role="dialog"] [class*="model"]',
        '[role="dialog"] [class*="pill"]',
    ].join(', ')).first();
    if (await pill.count() === 0) return '';
    return (await pill.textContent().catch(() => '')) || '';
}

module.exports = {
    hasApiKey,
    openWriteWithAi,
    generate,
    pickSuggestions,
    keepAndInsert,
    hasGlossaryToggle,
    getModelPill,
};

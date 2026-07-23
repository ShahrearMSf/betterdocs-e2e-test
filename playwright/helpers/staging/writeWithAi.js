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
    // Button lives in the editor toolbar, which only mounts after the
    // Gutenberg React app + BetterDocs bundle have finished booting. Wait
    // for the button to actually be visible (up to 20s) instead of
    // assuming a preceding wait already covered it. Cuts down on flaky
    // "modal not available" skips.
    const trigger = page.locator([
        '.bd-write-with-ai-button',
        'button:has-text("Write with AI")',
        'button:has-text("Write with BetterDocs AI")',
        'button:has-text("BetterDocs AI")',
        '[aria-label*="Write with AI" i]',
    ].join(', ')).first();
    try {
        await trigger.waitFor({ state: 'visible', timeout: 20_000 });
    } catch (_) {
        return false;
    }
    await trigger.click({ timeout: 6_000 }).catch(() => {});
    // Modal marker — dialog / class starting with bd- or betterdocs-.
    const modal = page.locator([
        '[role="dialog"]:has-text("Write with AI")',
        '[role="dialog"]:has-text("Write with BetterDocs AI")',
        '.bd-write-with-ai-modal',
        '.bd-ai-modal',
    ].join(', ')).first();
    try {
        await modal.waitFor({ state: 'visible', timeout: 12_000 });
        return true;
    } catch (_) {
        // Fallback: check for a modal wrapper that mentions WWAI copy
        // in its text — filters out Gutenberg's welcome tour and other
        // generic overlays that happen to be visible at the moment.
        const fallback = page.locator([
            '[class*="write-with-ai"]',
            '[class*="wwai"]',
            '.bd-ai-modal',
        ].join(', ')).first();
        if (await fallback.count() > 0 && await fallback.isVisible().catch(() => false)) {
            const t = (await fallback.textContent().catch(() => '')) || '';
            if (/write\s*with|prompt|source|Git|generate|BetterDocs\s*AI/i.test(t)) {
                return true;
            }
        }
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
    // Wait for a completion marker specific to the Write with AI modal.
    // The previous version accepted `[role="alert"]` and any `[class*="preview"]`
    // globally, which matched wp-admin boot notices and unrelated UI on
    // the page — leading to a false "ok" while the modal actually crashed
    // or showed a no-key notice. Scope markers to the modal container.
    const scope = page.locator('[role="dialog"], .bd-ai-modal, [class*="write-with-ai"]').first();
    const done = scope.locator([
        'button:has-text("Keep & insert")',
        'button:has-text("Keep and insert")',
        'button:has-text("Insert")',
        'button:has-text("Accept")',
        '[class*="preview"]',
    ].join(', ')).first();
    try {
        await done.waitFor({ state: 'visible', timeout: 60_000 });
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

/**
 * Look for a "missing API key" / "not configured" style notice inside the
 * Write with AI modal (or on the page). Returns { visible: bool, text }.
 * Called by tests that want to prove the no-key surface behaves gracefully
 * instead of being skipped.
 */
async function findMissingKeyNotice(page) {
    // Notice can be inside the modal itself, a settings-link callout, or a
    // Gutenberg notice bar. Match by broad text patterns so we tolerate
    // copy churn across releases.
    const matchers = [
        // Explicit "API key required / missing / not configured" surfaces.
        /API\s*key\s*(is\s*)?(required|missing|not\s*(configured|set|added|added yet))/i,
        /No\s*API\s*key/i,
        // Action-word variants — the modal on release 4.5.7 says
        // "Please insert your OpenAI API Key" and "Connect an API key in
        // Settings", so the older "configure|add|set" list wasn't enough.
        /Please\s*(configure|add|set|insert|enter|provide)\s*(your\s*|an\s*)?(OpenAI\s*)?API\s*Key/i,
        /Connect\s*(an\s*|the\s*)?API\s*key/i,
        /Add\s*API\s*key/i,
        // Broader gate copy — "settings → AI to enable generation",
        // "configure BetterDocs AI", "contact admin", "not available".
        /Settings.*(?:AI|enable\s*generation)/i,
        /Configure\s*(BetterDocs\s*)?AI/i,
        /Contact\s*(the\s*)?(site\s*)?administrator/i,
        /not\s*(currently\s*)?available/i,
        /not\s*configured/i,
    ];
    // Read the full rendered text (document.body.innerText) — React
    // portals mount modals outside the caller's scope in the DOM tree, so
    // a scoped textContent() from `[role="dialog"]` can miss the notice
    // even when a human clearly sees it. innerText also collapses
    // whitespace the way the user sees it, avoiding regex false-negatives
    // from fragmented text nodes.
    const text = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    for (const re of matchers) {
        const m = text.match(re);
        if (m) return { visible: true, text: m[0].slice(0, 200) };
    }
    return { visible: false, text: '' };
}

module.exports = {
    hasApiKey,
    openWriteWithAi,
    generate,
    pickSuggestions,
    keepAndInsert,
    hasGlossaryToggle,
    getModelPill,
    findMissingKeyNotice,
};

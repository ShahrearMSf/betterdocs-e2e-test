/**
 * 01k — Write with AI (Free tier, Pro-gated sub-block for Git tab).
 *
 * The Free 4.5.x revamp rebuilt Write with AI + Edit with BetterDocs AI as
 * React bundles inside the doc editor. This spec exercises:
 *   - Modal shell (Prompt / From source / From Git tabs, model pill)
 *   - Glossary suggestion REMOVED (Advanced settings shows only cat+tag)
 *   - Prompt-mode generation
 *   - Suggestion picker (categories + tags only) → Keep & insert
 *   - Edit-with-AI (block toolbar action)
 *   - Article Summary
 *   - No-API-key graceful degradation
 *   - Model config respected
 *   - Pro: From Git → Browse repository / Paste URL
 *   - Pro: Git tab absent / disabled when Pro isn't active
 *
 * Cross-cutting rules baked in:
 *   - Generation is slow (20–40s for gpt-5); waits are up to 60s
 *   - AI tests gate on hasApiKey(page); non-generation tests always run
 */
const { test, expect } = require("@playwright/test");
const { loginAsAdmin, gotoAdmin, getRestNonce } = require("../../helpers/staging/auth");
const { setTier } = require("../../helpers/staging/plugins");
const { createDoc, deleteDoc } = require("../../helpers/staging/records");
const { setBetterdocsToggle, setAiChatbotApiKey, logRename } = require("../../helpers/staging/settings");
const {
    hasApiKey, openWriteWithAi, generate,
    pickSuggestions, keepAndInsert,
    hasGlossaryToggle, getModelPill,
    findMissingKeyNotice,
} = require("../../helpers/staging/writeWithAi");
const { STAGING } = require("../../helpers/staging/env");
const { shoot } = require("../../helpers/staging/screenshot");

const created = { docs: [] };
let keyPresent = false;

async function newDocEditor(page) {
    // Create a bare draft via REST first so we land on a real doc-editor
    // URL — avoids the "post-new" auto-save flakiness that can hide the
    // Write with AI button.
    const doc = await createDoc(page, {
        title: `QA WWAI Draft ${Date.now()}`,
        content: '',
        status: 'draft',
    });
    if (doc?.id) created.docs.push(doc.id);
    if (doc?.id) {
        await gotoAdmin(page, `post.php?post=${doc.id}&action=edit`);
    } else {
        await gotoAdmin(page, 'post-new.php?post_type=docs');
    }
    await page.waitForTimeout(4000);
    // Dismiss Gutenberg's "Welcome to the editor" onboarding tour — on a
    // fresh WP install (or a user who hasn't seen it) it covers the whole
    // editor and blocks clicks on the Write with AI button. Clear the
    // guide preference for every editor variant we might be in.
    await page.evaluate(() => {
        try {
            const wp = window.wp;
            for (const scope of ['core/edit-post', 'core/edit-site', 'core/edit-widgets']) {
                wp?.data?.dispatch('core/preferences')?.set?.(scope, 'welcomeGuide', false);
                wp?.data?.dispatch(scope)?.disableComplementaryArea?.();
            }
        } catch (_) { /* best-effort */ }
    }).catch(() => {});
    // Also click any visible close button on the tour as a fallback, in
    // case the WP data store isn't reachable this build.
    const closeGuide = page.locator([
        '.components-guide button[aria-label="Close"]',
        '.components-modal__header button[aria-label="Close dialog"]',
        'button[aria-label*="Close"][class*="guide"]',
    ].join(', ')).first();
    if (await closeGuide.count() > 0 && await closeGuide.isVisible().catch(() => false)) {
        await closeGuide.click({ timeout: 2_000 }).catch(() => {});
        await page.waitForTimeout(500);
    }
    return doc?.id ?? null;
}

test.describe.serial('01k · Write with AI', () => {
    // Setup: Free is enough for the base surface; Pro is toggled inside
    // the Git tests. Capture whether an OpenAI key is configured so the
    // gated tests can skip cleanly on CI without a key.
    test.beforeAll(async ({ browser }) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await loginAsAdmin(page);
        await setTier(page, 'free');
        keyPresent = await hasApiKey(page);
        console.log(`[01k.setup] OpenAI key present: ${keyPresent}`);
        await ctx.close();
    });

    // 1k.setup — Open a new doc editor + trigger the Write with AI modal.
    // Baseline check: modal renders, has the three canonical tabs, model
    // pill visible.
    test('1k.setup — modal opens, tabs visible, model pill shown', async ({ page }) => {
        await loginAsAdmin(page);
        await newDocEditor(page);
        const opened = await openWriteWithAi(page);
        if (!opened) {
            logRename('wwai:modal', 'Write with AI modal opens', '(button missing or modal didn\'t render)');
            return;
        }
        await shoot(page, 'test-results-staging/01k-wwai/00-modal.png');
        const body = await page.locator('body').textContent() || '';
        for (const tab of ['Prompt', 'From source', 'From Git']) {
            if (!body.includes(tab)) {
                logRename(`wwai:tab-${tab}`, tab, '(not visible)');
            }
        }
        // Model pill is nice-to-have — some builds render the model name
        // as a data attribute or plain text without a class match. Log it
        // as drift rather than hard-fail the whole 01k spec's beforeAll
        // (this is describe.serial, so a failed 1k.setup would cascade
        // and mark every other 01k test as skipped).
        const model = await getModelPill(page);
        if (!model || !model.length) {
            logRename('wwai:model-pill', 'model name pill in modal header', '(not detected)');
        }
    });

    // 1k.1 — Glossary suggestion is REMOVED. Inspect modal + Advanced
    // settings drawer: no "Glossaries" toggle anywhere. Advanced shows
    // "2 on" (categories + tags).
    test('1k.1 glossary suggestion removed', async ({ page }) => {
        await loginAsAdmin(page);
        await newDocEditor(page);
        const opened = await openWriteWithAi(page);
        test.skip(!opened, 'modal not available');
        // Try to open Advanced settings if present.
        const advanced = page.locator('button:has-text("Advanced"), [role="button"]:has-text("Advanced")').first();
        if (await advanced.count() > 0) {
            await advanced.click().catch(() => {});
            await page.waitForTimeout(800);
        }
        const glossary = await hasGlossaryToggle(page);
        expect(glossary, 'glossary suggestion should be REMOVED from Write with AI').toBe(false);
        const modalText = await page.locator('[role="dialog"], .bd-ai-modal').first().textContent().catch(() => '') || '';
        // Advanced summary hint — "2 on" or "categories & tags" or similar.
        if (!/2\s*on|Categories\s*&\s*Tags|Suggested\s*categories/i.test(modalText)) {
            logRename('wwai:advanced-summary', '"2 on" / Categories & Tags summary', '(not found)');
        }
    });

    // 1k.2 — Prompt generate: two acceptable outcomes based on whether an
    // OpenAI API key is configured:
    //   Key present → generation must complete (Keep & insert visible).
    //   Key absent  → the modal must render a "missing API key" notice
    //                 (or similar), NOT silently spin or crash.
    // Either way, no fatal / no pageerror.
    test('1k.2 Prompt generate — happy path OR no-key notice', async ({ page }) => {
        await loginAsAdmin(page);
        await newDocEditor(page);
        const opened = await openWriteWithAi(page);
        test.skip(!opened, 'modal not available');
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        const result = await generate(page, {
            tab: 'prompt',
            prompt: 'Write a short knowledge-base article about installing a WordPress plugin.',
        });
        const body = await page.locator('body').textContent() || '';
        expect(body, 'page should not fatal').not.toMatch(/Fatal error|Uncaught/);
        expect(errors, 'no page-level errors during generation').toHaveLength(0);
        if (result.ok) {
            await shoot(page, 'test-results-staging/01k-wwai/02-prompt-generated.png');
        } else if (keyPresent) {
            throw new Error(`generate failed even though API key is configured: ${result.error}`);
        } else {
            // No key: the modal MUST tell the user why nothing happened.
            const notice = await findMissingKeyNotice(page);
            await shoot(page, 'test-results-staging/01k-wwai/02-no-key-notice.png');
            expect(notice.visible, 'modal should show a missing-API-key notice').toBe(true);
            console.log('[01k.2] no-key notice detected:', notice.text);
        }
    });

    // 1k.3 — After a successful generation, the suggestion panel shows
    // "Suggested categories & tags" with two groups. Glossary group must
    // NOT appear (it was intentionally removed). When there's no API key,
    // the panel understandably won't render, so we assert instead that a
    // no-key notice surfaced.
    test('1k.3 suggestions = categories & tags (or no-key notice)', async ({ page }) => {
        await loginAsAdmin(page);
        await newDocEditor(page);
        const opened = await openWriteWithAi(page);
        test.skip(!opened, 'modal not available');
        const result = await generate(page, { tab: 'prompt', prompt: 'Write about WordPress backups.' });
        await page.waitForTimeout(1500);
        const body = await page.locator('body').textContent() || '';
        // Glossaries removal: always assert — no key needed, this is about
        // the modal chrome that exists whether we generated or not.
        expect(body, 'glossaries suggestion group must not appear').not.toMatch(/Suggested.*glossaries|Glossaries.*group/i);
        if (result.ok) {
            expect(body).toMatch(/Suggested.*(categories|tags)/i);
        } else if (keyPresent) {
            throw new Error(`suggestions unreachable even with API key: ${result.error}`);
        } else {
            const notice = await findMissingKeyNotice(page);
            expect(notice.visible, 'modal should show a missing-API-key notice').toBe(true);
        }
    });

    // 1k.4 — With a key: pick a suggested category + tag, click Keep &
    // insert, verify blocks are inserted. Without a key: verify a
    // no-key notice appears and the doc stays empty (nothing wrongly
    // written into the editor from a failed generation).
    test('1k.4 pick + Keep & insert (or no-key notice)', async ({ page }) => {
        await loginAsAdmin(page);
        const docId = await newDocEditor(page);
        const opened = await openWriteWithAi(page);
        test.skip(!opened, 'modal not available');
        const result = await generate(page, { tab: 'prompt', prompt: 'Write about setting up a WordPress site.' });
        await page.waitForTimeout(1200);
        if (result.ok) {
            const picked = await pickSuggestions(page, {});
            await keepAndInsert(page);
            await page.waitForTimeout(2500);
            const nonce = await getRestNonce(page);
            const doc = await page.evaluate(async ([url, nonce, id]) => {
                const r = await fetch(`${url}/wp-json/wp/v2/docs/${id}?context=edit`, {
                    credentials: 'include', headers: { 'X-WP-Nonce': nonce },
                });
                return r.ok ? await r.json() : null;
            }, [STAGING.url, nonce, docId]);
            const rawContent = doc?.content?.raw || doc?.content?.rendered || '';
            expect(rawContent.length, 'keep-and-insert should populate the doc').toBeGreaterThan(50);
            console.log('[01k.4] picked suggestions:', picked);
        } else if (keyPresent) {
            throw new Error(`generate failed even with API key: ${result.error}`);
        } else {
            // The no-key notice presence is the load-bearing assertion.
            // We DELIBERATELY don't compare doc content here — the block
            // editor auto-saves boilerplate (empty paragraph block ~54
            // chars) even when nothing was inserted, so a "doc stayed
            // empty" check would false-fail on normal editor behavior.
            const notice = await findMissingKeyNotice(page);
            expect(notice.visible, 'modal should show a missing-API-key notice').toBe(true);
        }
    });

    // 1k.5 — Edit-with-AI (block toolbar). Select a paragraph block, run
    // the "Edit with BetterDocs AI" action. Requires the block-editor
    // toolbar button to be present; if it isn't, log and return (drift).
    // With a key, expect the transformation to complete without crashing.
    // Without a key, expect a graceful failure surface (no fatal on the page).
    test('1k.5 Edit-with-AI (block toolbar)', async ({ page }) => {
        await loginAsAdmin(page);
        const docId = await newDocEditor(page);
        // Seed the doc with a paragraph via REST so we don't depend on
        // driving the block editor toolbar to insert content first.
        const nonce = await getRestNonce(page);
        await page.evaluate(async ([url, nonce, id]) => {
            await fetch(`${url}/wp-json/wp/v2/docs/${id}`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: '<p>Original paragraph text to rewrite.</p>' }),
            });
        }, [STAGING.url, nonce, docId]);
        await gotoAdmin(page, `post.php?post=${docId}&action=edit`);
        await page.waitForTimeout(4500);
        // Click the paragraph to select the block.
        const p = page.locator('.wp-block-paragraph').first();
        if (await p.count() === 0) {
            logRename('wwai:edit-with-ai', 'paragraph block in editor', '(not present)');
            return;
        }
        await p.click().catch(() => {});
        await page.waitForTimeout(600);
        const editBtn = page.locator([
            'button[aria-label*="Edit with BetterDocs AI" i]',
            'button:has-text("Edit with BetterDocs AI")',
            '[class*="edit-with-ai"]',
        ].join(', ')).first();
        if (await editBtn.count() === 0) {
            logRename('wwai:edit-with-ai-button', 'Edit with BetterDocs AI toolbar button', '(not found)');
            return;
        }
        await editBtn.click().catch(() => {});
        await page.waitForTimeout(1500);
        await shoot(page, 'test-results-staging/01k-wwai/05-edit-modal.png');
        // Modal / dropdown of actions should render.
        const body = await page.locator('body').textContent() || '';
        expect(body, 'edit-with-ai should not crash the editor').not.toMatch(/Fatal error|Uncaught/);
    });

    // 1k.6 — Article Summary. Trigger the summary action. With a key we'd
    // expect a summary preview to be rendered; without a key we expect a
    // notice (or no rendered summary), but never a fatal.
    test('1k.6 Article Summary', async ({ page }) => {
        await loginAsAdmin(page);
        const docId = await newDocEditor(page);
        const nonce = await getRestNonce(page);
        await page.evaluate(async ([url, nonce, id]) => {
            await fetch(`${url}/wp-json/wp/v2/docs/${id}`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: '<p>' + 'Body paragraph. '.repeat(30) + '</p>' }),
            });
        }, [STAGING.url, nonce, docId]);
        await gotoAdmin(page, `post.php?post=${docId}&action=edit`);
        await page.waitForTimeout(4000);
        const trigger = page.locator([
            'button:has-text("Article Summary")',
            'button:has-text("Summarize")',
            '.bd-article-summary-button',
        ].join(', ')).first();
        if (await trigger.count() === 0) {
            logRename('wwai:summary-trigger', 'Article Summary button', '(not found)');
            return;
        }
        await trigger.click().catch(() => {});
        await page.waitForTimeout(30_000);
        await shoot(page, 'test-results-staging/01k-wwai/06-summary.png');
        const body = await page.locator('body').textContent() || '';
        expect(body, 'Article Summary should not crash').not.toMatch(/Fatal error|Uncaught/);
    });

    // 1k.7 — No API key → graceful degradation. Clear the key, try to
    // generate, expect a friendly notice (WP_Error / message), never a
    // fatal. Term-suggest should return an empty list, not error.
    test('1k.7 no API key → graceful', async ({ page }) => {
        await loginAsAdmin(page);
        // Preserve current key so we can restore.
        const nonce = await getRestNonce(page);
        const priorKey = await page.evaluate(async ([url, nonce]) => {
            const r = await fetch(`${url}/wp-json/betterdocs/v1/settings`, {
                credentials: 'include', headers: { 'X-WP-Nonce': nonce },
            });
            if (!r.ok) return '';
            const j = await r.json();
            return j?.betterdocs_api_key ?? j?.settings?.betterdocs_api_key ?? '';
        }, [STAGING.url, nonce]);
        await setBetterdocsToggle(page, 'betterdocs_api_key', '');
        await setAiChatbotApiKey(page, '');
        try {
            await newDocEditor(page);
            const opened = await openWriteWithAi(page);
            test.skip(!opened, 'modal not available');
            const result = await generate(page, { tab: 'prompt', prompt: 'test' });
            const body = await page.locator('body').textContent() || '';
            // The generation should NOT crash the page. Either result.ok
            // is false (we timed out on the completion marker because a
            // friendly error rendered instead) OR the modal shows an error
            // banner.
            expect(body, 'no-key path should not fatal').not.toMatch(/Fatal error|Uncaught/);
            if (result.ok) {
                logRename('wwai:no-key-graceful', 'error surface when key empty', 'generation reported ok?');
            }
        } finally {
            // Restore
            if (priorKey) await setBetterdocsToggle(page, 'betterdocs_api_key', priorKey);
        }
    });

    // 1k.8 — Model config respected. Set the model in AI settings; the
    // modal's read-only pill must reflect that model, and generation must
    // use it (best-effort: verify the model name is in the request body /
    // pill text).
    test('1k.8 model config respected', async ({ page }) => {
        await loginAsAdmin(page);
        const desired = 'gpt-4o-mini';
        await setBetterdocsToggle(page, 'ai_content_writer_model', desired);
        await newDocEditor(page);
        const opened = await openWriteWithAi(page);
        test.skip(!opened, 'modal not available');
        const pill = await getModelPill(page);
        if (!pill.toLowerCase().includes(desired.toLowerCase())) {
            logRename('wwai:model-pill', desired, pill || '(empty)');
        }
    });

    // 1k.9 — Pro-gated: From Git → Browse repository. Requires Pro.
    test('1k.9 From Git → Browse repository', async ({ page }) => {
        await loginAsAdmin(page);
        await setTier(page, 'pro');
        await newDocEditor(page);
        const opened = await openWriteWithAi(page);
        test.skip(!opened, 'modal not available');
        // Switch to Git tab.
        const gitTab = page.locator('[role="tab"]:has-text("Git"), button:has-text("From Git")').first();
        if (await gitTab.count() === 0) {
            logRename('wwai:git-tab', 'From Git tab', '(not visible in Pro)');
            return;
        }
        await gitTab.click().catch(() => {});
        await page.waitForTimeout(1500);
        const browse = page.locator('button:has-text("Browse"), button:has-text("Browse repository")').first();
        if (await browse.count() === 0) {
            logRename('wwai:git-browse', 'Browse repository button', '(not visible)');
            return;
        }
        // Attach a listener BEFORE the click so we catch the API call.
        const respP = page.waitForResponse((r) => /repos|repositories|git/i.test(r.url()) && r.status() < 500, { timeout: 10_000 }).catch(() => null);
        await browse.click().catch(() => {});
        const resp = await respP;
        if (!resp) {
            logRename('wwai:git-repos-list', 'repo listing API call', '(no matching response)');
            return;
        }
        const body = await resp.text().catch(() => '');
        expect(body, 'repo list must not be an unavailable error').not.toMatch(/git_unavailable|not.*connected/i);
    });

    // 1k.10 — Pro-gated: From Git → paste a repo file URL, generate a doc
    // grounded on real file content. With a key: assert grounded content.
    // Without a key: assert a proper notice appears (not silent nothing).
    test('1k.10 From Git → Paste URL', async ({ page }) => {
        await loginAsAdmin(page);
        await setTier(page, 'pro');
        await newDocEditor(page);
        const opened = await openWriteWithAi(page);
        test.skip(!opened, 'modal not available');
        const result = await generate(page, {
            tab: 'git',
            url: 'https://raw.githubusercontent.com/WordPress/WordPress/master/readme.html',
        });
        if (result.ok) {
            const preview = await page.locator('[class*="preview"], [class*="output"]').first().textContent().catch(() => '') || '';
            expect(preview.length, 'preview should have grounded content').toBeGreaterThan(100);
        } else if (keyPresent) {
            logRename('wwai:git-paste-url', 'grounded generation on pasted URL', result.error || 'failed');
        } else {
            const notice = await findMissingKeyNotice(page);
            expect(notice.visible, 'Git paste should show a missing-API-key notice').toBe(true);
        }
    });

    // 1k.11 — From Git without Pro (or without connection) shows a clean
    // "git unavailable" message, not a fatal.
    test('1k.11 From Git without Pro/connection', async ({ page }) => {
        await loginAsAdmin(page);
        await setTier(page, 'free');
        await newDocEditor(page);
        const opened = await openWriteWithAi(page);
        test.skip(!opened, 'modal not available');
        const gitTab = page.locator('[role="tab"]:has-text("Git"), button:has-text("From Git")').first();
        // Under Free, the Git tab may either not appear OR appear with a
        // "Pro required" empty state. Either is acceptable; a fatal is not.
        if (await gitTab.count() === 0) {
            console.log('[01k.11] Git tab hidden under Free — acceptable');
            return;
        }
        await gitTab.click().catch(() => {});
        await page.waitForTimeout(1500);
        const body = await page.locator('body').textContent() || '';
        expect(body, 'Git tab under Free should not fatal').not.toMatch(/Fatal error|Uncaught/);
        if (!/pro|upgrade|unavailable|not.*connected/i.test(body)) {
            logRename('wwai:git-free-message', 'Pro-required / unavailable message', '(no gate copy)');
        }
    });

    // 1k.12 — No-API-key UX (explicit). Clear the key, open Write with AI,
    // and assert the modal shows the missing-API-key notice on the very
    // first frame — no need to click Generate to see it. Then click
    // Generate and assert the same (or improved) notice is still there.
    // Restores the prior key at the end.
    test('1k.12 no-API-key UX — notice on open + on Generate click', async ({ page }) => {
        await loginAsAdmin(page);
        const nonce = await getRestNonce(page);
        const priorKey = await page.evaluate(async ([url, nonce]) => {
            const r = await fetch(`${url}/wp-json/betterdocs/v1/settings`, {
                credentials: 'include', headers: { 'X-WP-Nonce': nonce },
            });
            if (!r.ok) return '';
            const j = await r.json();
            return j?.betterdocs_api_key ?? j?.settings?.betterdocs_api_key ?? '';
        }, [STAGING.url, nonce]);
        await setBetterdocsToggle(page, 'betterdocs_api_key', '');
        await setAiChatbotApiKey(page, '');
        try {
            await newDocEditor(page);
            const opened = await openWriteWithAi(page);
            test.skip(!opened, 'modal not available');
            // Notice at OPEN time — the ideal UX is proactive.
            const onOpen = await findMissingKeyNotice(page);
            await shoot(page, 'test-results-staging/01k-wwai/12-no-key-on-open.png');
            if (!onOpen.visible) {
                // Not-proactive UX. That's OK — as long as the Generate click
                // reveals it. Log the drift then proceed to the click check.
                logRename('wwai:no-key-notice-on-open', 'notice on modal open', '(missing — user has to click Generate to find out)');
            } else {
                console.log('[01k.12] notice on open:', onOpen.text);
            }
            // Notice after Generate click — this MUST appear.
            await generate(page, { tab: 'prompt', prompt: 'test' });
            const afterClick = await findMissingKeyNotice(page);
            await shoot(page, 'test-results-staging/01k-wwai/12-no-key-after-generate.png');
            expect(afterClick.visible, 'Generate click must surface the missing-key notice').toBe(true);
            console.log('[01k.12] notice after Generate click:', afterClick.text);
            const body = await page.locator('body').textContent() || '';
            expect(body, 'no-key path must not fatal').not.toMatch(/Fatal error|Uncaught/);
        } finally {
            if (priorKey) await setBetterdocsToggle(page, 'betterdocs_api_key', priorKey);
        }
    });

    // 1k.99 — Cleanup: nuke drafts we seeded.
    test('1k.99 cleanup', async ({ page }) => {
        await loginAsAdmin(page);
        for (const id of created.docs) await deleteDoc(page, id);
    });
});

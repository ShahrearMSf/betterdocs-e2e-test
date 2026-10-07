/**
 * Page-text extraction that ignores <script> / <style> source.
 *
 * Why this exists: `page.locator('body').textContent()` concatenates the text
 * of EVERY descendant node — including the contents of inline <script> tags.
 * WordPress pages inline a lot of JSON config (BetterDocs ships
 * `var betterDocsBlocksHelper = {...,"betterdocs_glossaries":[],...}` into the
 * doc editor), so a regex meant to describe what the user SEES would instead
 * match JavaScript source. That is what made 1k.3 fail against a plugin that
 * was behaving correctly, and it is a latent false-positive in every
 * `not.toMatch(/Fatal error|Uncaught/)` guard in this suite — any bundle that
 * merely contains the word "Uncaught" would fail a perfectly healthy page.
 *
 * We deliberately keep `textContent` semantics instead of switching to
 * `innerText`: innerText returns only *rendered* text, which would silently
 * drop content sitting in collapsed panels and inactive settings tabs that a
 * number of positive assertions here depend on. So: clone the subtree, drop
 * the non-content nodes, then read textContent.
 */

const NON_CONTENT = 'script, style, noscript, template';

/**
 * Text of `selector` (default: the whole body) with script and style source
 * stripped out. Returns '' rather than throwing, matching how callers already
 * treated an unreadable page.
 *
 * Note this goes through a locator rather than `page.evaluate` +
 * `document.querySelector`. That is load-bearing: a locator auto-waits for the
 * element to attach, and the login flow reads body text while wp-login.php is
 * still mid-navigation. A bare querySelector returns null there, which handed
 * back '' and made `solveHumanityChallenge` miss the challenge and fail the
 * whole run at global-setup.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} [selector] CSS selector; a comma-list is fine.
 * @param {number} [timeout] ms to wait for the element to attach.
 */
async function pageText(page, selector = 'body', timeout = 15_000) {
    try {
        const el = page.locator(selector).first();
        await el.waitFor({ state: 'attached', timeout });
        return await el.evaluate((root, strip) => {
            const clone = root.cloneNode(true);
            clone.querySelectorAll(strip).forEach((n) => n.remove());
            return clone.textContent || '';
        }, NON_CONTENT);
    }
    catch {
        // Element never attached, page closed, or navigated mid-evaluate.
        // Callers previously used `.catch(() => '')` / `|| ''`, so keep
        // returning a string.
        return '';
    }
}

module.exports = { pageText };

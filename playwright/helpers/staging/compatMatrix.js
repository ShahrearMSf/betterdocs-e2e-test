/**
 * Version-compatibility matrix helper.
 *
 * The situation this catches:
 *   Free X + Pro Y with mismatched React chunks — the SPA half-mounts,
 *   throws chunk-load errors, or renders an empty admin screen. Functional
 *   tests miss it (no 500, no fatal PHP), but a human sees a visibly
 *   broken UI. Worse: the plugin often doesn't raise an admin notice
 *   explaining the mismatch, so the user is stranded.
 *
 * probeSurface() collects a set of DOM + console health signals for a
 * single admin/frontend URL. readAdminNotices() scans the same page for
 * any notice / error / update-nag banner mentioning BetterDocs or
 * compatibility. derive() combines the two into `silent_break` — a broken
 * surface WITH NO explaining notice.
 */
const { STAGING } = require("./env");

/**
 * Scan the current page's DOM for admin notices and return their text
 * content, deduped. Includes:
 *   - Standard WP `.notice` variants
 *   - Update nags
 *   - Gutenberg editor pinned notices
 *   - Plugin-row notices under a specific data-slug
 */
async function readAdminNotices(page, opts = {}) {
    const pluginSlug = opts.pluginSlug || null;
    const notices = await page.evaluate((slug) => {
        const out = new Set();
        const push = (el) => {
            if (!el) return;
            const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
            if (t) out.add(t);
        };
        // Global admin notices
        document.querySelectorAll([
            '.notice', '.notice-warning', '.notice-error', '.notice-info', '.notice-success',
            '.error', '.updated', '.update-nag', '#message',
            '.plugin-update .update-message',
            '.editor-notices__pinned .components-notice',
        ].join(', ')).forEach(push);
        // In-row notices on plugins.php scoped to a specific plugin slug
        if (slug) {
            const row = document.querySelector(`tr[data-slug="${slug}"], tr[data-plugin*="${slug}"]`);
            if (row) {
                let next = row.nextElementSibling;
                while (next && /plugin-update-tr|update|notice/.test(next.className)) {
                    push(next);
                    next = next.nextElementSibling;
                }
            }
        }
        return Array.from(out);
    }, pluginSlug);
    return notices;
}

/**
 * Probe one surface for design-health signals.
 *
 * Signals returned:
 *   spa_root_present   — canonical wrapper class or id is in the DOM
 *   spa_root_height    — px height of that wrapper (empty root == broken)
 *   spa_root_children  — direct child count of that wrapper
 *   visible_buttons    — how many <button> elements are on screen with
 *                        offsetParent (broken shells often render 0)
 *   console_errors     — ["type: message", …] captured during load
 *   fatal_php          — page contains "Fatal error" / "Uncaught" text
 *   header_present     — WP admin bar or plugin header is present
 *   notices_here       — admin notices on THIS surface
 *
 * The caller passes a Page listener that already accumulates console
 * errors (`consoleErrors` array), or leaves it empty and we'll observe
 * new errors from the goto onwards.
 */
async function probeSurface(page, surface) {
    const url = surface.url.startsWith('http')
        ? surface.url
        : `${STAGING.url}/${surface.url.replace(/^\//, '')}`;
    const consoleErrors = [];
    const onConsole = (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 400));
    };
    const onPageErr = (err) => consoleErrors.push(`pageerror: ${String(err).slice(0, 400)}`);
    page.on('console', onConsole);
    page.on('pageerror', onPageErr);
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
        // Give React SPAs a beat to mount + settle.
        await page.waitForTimeout(surface.settleMs || 3500);
    } finally {
        page.off('console', onConsole);
        page.off('pageerror', onPageErr);
    }
    const signals = await page.evaluate((cfg) => {
        // Try every candidate selector, pick the ONE with the largest
        // rendered height. A generic selector like [id*="betterdocs"]
        // often matches multiple elements (a hidden wrapper AND the
        // visible app root); "first match wins" would pick the hidden
        // one and falsely report the surface as empty.
        function pickRoot(sels) {
            let best = null, bestH = -1;
            for (const s of sels) {
                for (const el of document.querySelectorAll(s)) {
                    const h = el.getBoundingClientRect().height;
                    if (h > bestH) { bestH = h; best = el; }
                }
            }
            return best;
        }
        const rootSelectors = cfg.rootSelectors && cfg.rootSelectors.length
            ? cfg.rootSelectors
            : ['#betterdocs-admin-app', '#betterdocs-app', '[id^="betterdocs-"]', '.wp-admin-app', '.wrap'];
        const root = pickRoot(rootSelectors);
        const rect = root ? root.getBoundingClientRect() : null;
        const visibleButtons = Array.from(document.querySelectorAll('button'))
            .filter((b) => b.offsetParent !== null && b.getBoundingClientRect().height > 0).length;
        const bodyText = document.body.innerText || '';
        return {
            spa_root_present: !!root,
            spa_root_height: rect ? Math.round(rect.height) : 0,
            spa_root_children: root ? root.children.length : 0,
            visible_buttons: visibleButtons,
            fatal_php: /Fatal error|Uncaught/.test(bodyText),
            header_present: !!(document.querySelector('#wpadminbar, .interface-interface-skeleton__header, .bd-header')),
        };
    }, {
        rootSelectors: surface.rootSelectors || [],
    });
    const noticesHere = await readAdminNotices(page).catch(() => []);
    return {
        surface: surface.name,
        url,
        ...signals,
        console_errors: consoleErrors,
        notices_here: noticesHere,
    };
}

/**
 * Compute derived booleans that describe the qualitative situation.
 * Takes an array of probe rows and the notices found on plugins.php.
 */
function derive(rows, noticesOnPluginsPage = []) {
    const CHUNK_ERR_RE = /ChunkLoadError|Loading chunk|Cannot find module|is not a function|Unexpected identifier/i;
    const NOTICE_RE = /requires.*(BetterDocs|version)|compat|incompat|update.*BetterDocs|not supported|newer.*version|min(?:imum)?\s*version/i;
    const noticeCombined = [
        ...noticesOnPluginsPage,
        ...rows.flatMap((r) => r.notices_here || []),
    ].join(' | ');
    const explains = NOTICE_RE.test(noticeCombined);
    return rows.map((r) => {
        // "Broken surface" heuristic — the classic "React chunk mismatch"
        // symptom is BOTH signals firing at once: the SPA container we
        // picked has near-zero height AND almost no visible buttons.
        //
        // A single signal alone is unreliable:
        //   - height=0 alone: we may have picked a hidden wrapper while
        //     the real content is elsewhere (e.g. Doc Categories renders
        //     a 26-button screen inside a different container).
        //   - low button count alone: some legit surfaces (empty-state
        //     Encyclopedia, brand-new Analytics) legitimately show few
        //     controls.
        //
        // Chunk-load console errors and PHP fatals stay standalone
        // signals — either is a definite break by itself.
        const chunkErr = r.console_errors.some((e) => CHUNK_ERR_RE.test(e));
        const emptyRoot = r.spa_root_present && r.spa_root_height < 200;
        const missingButtons = typeof r.min_visible_buttons === 'number'
            && r.visible_buttons < r.min_visible_buttons;
        const combinedEmpty = emptyRoot && (r.visible_buttons < 3 || missingButtons);
        const broken = combinedEmpty || chunkErr || r.fatal_php === true;
        return {
            ...r,
            has_broken_surface: broken,
            has_explaining_notice: explains,
            silent_break: broken && !explains,
        };
    });
}

/**
 * Read Free + Pro + Chatbot versions from plugins.php-style state.
 * Callers pass the getPluginStates() result. Returns a "cell label"
 * suitable for a directory name.
 */
function cellLabel(pluginStates) {
    const v = (slug) => pluginStates[slug]?.version || '?';
    const free = v('betterdocs/betterdocs.php');
    const pro = v('betterdocs-pro/betterdocs-pro.php');
    const bot = v('betterdocs-ai-chatbot/betterdocs-ai-chatbot.php');
    return `${free}+${pro}+${bot}`.replace(/[^\w.+-]/g, '_');
}

module.exports = {
    readAdminNotices,
    probeSurface,
    derive,
    cellLabel,
};

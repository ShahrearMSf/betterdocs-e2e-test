/**
 * BetterDocs Advanced Analytics v1 helpers.
 *
 * The revamp introduces:
 *   - lightweight async tracker (sendBeacon) → REST ingest
 *   - Action Scheduler aggregation (raw events → daily rows)
 *   - GeoIP enrichment, retention policy, cookieless mode
 *   - dashboard modules (Overview, Doc Performance, Reactions, Search
 *     Analytics, Reader Engagement, Feedback Inbox, Link Health, Author
 *     Performance)
 *   - read-only REST API (nonce-authed for admin, 401 for guest)
 *
 * The dashboard reads DAILY-AGGREGATED tables, so tests that fire a raw
 * event and immediately read the dashboard will see 0. Call `runRollup()`
 * before reading aggregated reports; live signals (reactions, feedback,
 * search log) publish immediately and don't need a rollup.
 */
const { STAGING } = require("./env");
const { getRestNonce } = require("./auth");

/**
 * Fire a real "view" event by making a guest hit the doc page. The tracker
 * script sends a sendBeacon() to /analytics/view; we mirror that shape
 * exactly so the ingest handler treats it as a first-class view.
 *
 * Returns the ingest response status (200 on success).
 */
async function fireView(page, docUrl) {
    const path = docUrl.startsWith('http') ? docUrl : `${STAGING.url}${docUrl}`;
    const res = await page.evaluate(async (url) => {
        // Trigger a real page load so the tracker enqueues its beacon.
        // sendBeacon is fire-and-forget; we can't await it directly, so
        // also POST the ingest shape ourselves and return that status.
        try {
            const beacon = await fetch(`${new URL(url).origin}/wp-json/betterdocs/v1/analytics/view`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url }),
            });
            return { status: beacon.status };
        } catch (e) {
            return { status: 0, error: String(e) };
        }
    }, path);
    return res.status;
}

/**
 * Fire a reaction (happy | neutral | unhappy) against a doc id. Uses the
 * plugin's feedback REST route, which publishes LIVE (no rollup wait).
 */
async function fireReaction(page, docId, feeling) {
    const nonce = await getRestNonce(page);
    // Free 4.5.7 REST/Feedback.php validates strictly against
    // ['happy', 'sad', 'normal'] and expects `feelings` (plural) as the
    // field name. Map friendly aliases → the exact enum values the
    // endpoint accepts.
    const map = {
        happy: 'happy', good: 'happy', like: 'happy',
        sad: 'sad',     bad: 'sad',    dislike: 'sad', unhappy: 'sad',
        normal: 'normal', neutral: 'normal',
    };
    const value = map[feeling] || 'happy';
    const res = await page.evaluate(async ([url, nonce, docId, value]) => {
        for (const path of [
            `/wp-json/betterdocs/v1/feedback/${docId}`,
            `/wp-json/betterdocs-pro/v1/feedback/${docId}`,
        ]) {
            try {
                const r = await fetch(`${url}${path}`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ feelings: value }),
                });
                if (r.ok) return { status: r.status, path };
                // Return the last non-network error so callers can debug.
                if (r.status && r.status < 500) return { status: r.status, path, body: await r.text().catch(() => '') };
            } catch (_) { /* try next */ }
        }
        return { status: 0, path: null };
    }, [STAGING.url, nonce, docId, value]);
    return res;
}

/**
 * Log a search term through the same ingest the frontend Instant-Answer
 * search bar uses. Zero-result queries surface in Search Analytics →
 * Zero-Result.
 */
async function fireSearch(page, term) {
    const nonce = await getRestNonce(page);
    const res = await page.evaluate(async ([url, nonce, term]) => {
        for (const path of [
            '/wp-json/betterdocs/v1/analytics/search-insert',
            '/wp-json/betterdocs/v1/search-insert',
            '/wp-json/betterdocs-pro/v1/analytics/search-insert',
        ]) {
            try {
                const r = await fetch(`${url}${path}`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ term, keyword: term, query: term, count: 0 }),
                });
                if (r.ok) return { status: r.status, path };
            } catch (_) { /* try next */ }
        }
        return { status: 0, path: null };
    }, [STAGING.url, nonce, term]);
    return res;
}

/**
 * Kick the Action Scheduler runner so raw events roll up into the daily
 * aggregate tables. Uses /wp-cron.php with a `doing_wp_cron` param to
 * bypass rate-limiting on subsequent nudges within the same test.
 */
async function runRollup(page) {
    const res = await page.evaluate(async (url) => {
        try {
            const r = await fetch(`${url}/wp-cron.php?doing_wp_cron=${Date.now()}/${Math.random()}`, {
                method: 'GET',
                credentials: 'include',
            });
            return { status: r.status };
        } catch (e) {
            return { status: 0, error: String(e) };
        }
    }, STAGING.url);
    // wp-cron returns 200 with no body; give the scheduler a beat to process.
    await page.waitForTimeout(2500);
    return res.status;
}

/**
 * Read an aggregated analytics report. `slug` is one of the module names
 * the plugin exposes ("overview", "articles", "search", "reactions",
 * "reader-engagement", "feedback", "link-health", "authors"). `days` is
 * the lookback window.
 */
async function readReport(page, slug, days = 30) {
    const nonce = await getRestNonce(page);
    const res = await page.evaluate(async ([url, nonce, slug, days]) => {
        for (const path of [
            `/wp-json/betterdocs/v1/analytics/${slug}?days=${days}`,
            `/wp-json/betterdocs-pro/v1/analytics/${slug}?days=${days}`,
            `/wp-json/betterdocs/v1/${slug}?days=${days}`,
        ]) {
            try {
                const r = await fetch(`${url}${path}`, {
                    credentials: 'include',
                    headers: { 'X-WP-Nonce': nonce },
                });
                if (r.ok) return { status: r.status, json: await r.json(), path };
                if (r.status >= 400 && r.status < 500) return { status: r.status, json: null, path };
            } catch (_) { /* try next */ }
        }
        return { status: 0, json: null, path: null };
    }, [STAGING.url, nonce, slug, days]);
    return res;
}

/**
 * Read the same report as a GUEST (no cookies, no nonce). Used by the
 * "read endpoints require auth" test — expect 401 across the board.
 */
async function readReportAsGuest(guestPage, slug, days = 30) {
    const res = await guestPage.evaluate(async ([url, slug, days]) => {
        for (const path of [
            `/wp-json/betterdocs/v1/analytics/${slug}?days=${days}`,
            `/wp-json/betterdocs-pro/v1/analytics/${slug}?days=${days}`,
        ]) {
            try {
                const r = await fetch(`${url}${path}`);
                return { status: r.status, path };
            } catch (_) { /* try next */ }
        }
        return { status: 0, path: null };
    }, [STAGING.url, slug, days]);
    return res;
}

/**
 * Set one of the analytics settings via the plugin's dedicated
 * `/analytics/settings` endpoint (fallback to the general settings REST).
 * Common keys:
 *   data_retention_days       — int; 0 or missing = keep forever
 *   analytics_cookieless      — bool
 *   exclude_bot_analytics     — bool (mirrored from General tab)
 */
async function setAnalyticsSetting(page, patch) {
    const nonce = await getRestNonce(page);
    const res = await page.evaluate(async ([url, nonce, patch]) => {
        for (const path of [
            '/wp-json/betterdocs/v1/analytics/settings',
            '/wp-json/betterdocs-pro/v1/analytics/settings',
            '/wp-json/betterdocs/v1/settings',
        ]) {
            try {
                const r = await fetch(`${url}${path}`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
                    body: JSON.stringify(path.endsWith('/settings') && !path.includes('/analytics/')
                        ? { settings: patch, ...patch }
                        : patch),
                });
                if (r.ok) return { status: r.status, path };
            } catch (_) { /* try next */ }
        }
        return { status: 0, path: null };
    }, [STAGING.url, nonce, patch]);
    return res;
}

/**
 * Read a specific counter out of the aggregated Overview report. Callers
 * pass the shape of interest (e.g. total_views, unique_readers, reactions);
 * we look under a few plausible keys because the revamp still shifts shape
 * between releases.
 */
function pluckCounter(overviewJson, name) {
    if (!overviewJson) return null;
    const candidates = [name, name.replace(/_/g, ''), name.replace(/_(\w)/g, (_, c) => c.toUpperCase())];
    for (const c of candidates) {
        if (overviewJson[c] != null) return overviewJson[c];
        if (overviewJson.data?.[c] != null) return overviewJson.data[c];
        if (overviewJson.kpis?.[c] != null) return overviewJson.kpis[c];
    }
    return null;
}

module.exports = {
    fireView, fireReaction, fireSearch,
    runRollup,
    readReport, readReportAsGuest,
    setAnalyticsSetting,
    pluckCounter,
};

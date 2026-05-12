const { STAGING } = require("./env");
const { getRestNonce } = require("./auth");
/** Tiny inline 1×1 PNG so we don't need fixture files on disk. */
const PNG_1X1_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9ZitDA8AAAAASUVORK5CYII=';
/**
 * Upload a 1x1 PNG to the Media Library and return its attachment.
 * Returns `null` on failure so callers can degrade gracefully.
 */
async function uploadTinyPng(page, filename = `qa-${Date.now()}.png`) {
    const nonce = await getRestNonce(page);
    return page.evaluate(async ([url, nonce, name, b64]) => {
        // Build a blob from base64
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++)
            bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'image/png' });
        const fd = new FormData();
        fd.append('file', blob, name);
        const r = await fetch(`${url}/wp-json/wp/v2/media`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'X-WP-Nonce': nonce },
            body: fd,
        });
        if (!r.ok)
            return null;
        const j = await r.json();
        return { id: j.id, source_url: j.source_url };
    }, [STAGING.url, nonce, filename, PNG_1X1_BASE64]);
}
/** Delete an uploaded attachment. */
async function deleteAttachment(page, id) {
    const nonce = await getRestNonce(page);
    await page.evaluate(async ([url, nonce, id]) => {
        await fetch(`${url}/wp-json/wp/v2/media/${id}?force=true`, {
            method: 'DELETE',
            credentials: 'include',
            headers: { 'X-WP-Nonce': nonce },
        });
    }, [STAGING.url, nonce, id]);
}

module.exports = { uploadTinyPng, deleteAttachment };

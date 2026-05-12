const { STAGING } = require("./env");
const { getRestNonce } = require("./auth");
async function createPageWithContent(page, args) {
    const nonce = await getRestNonce(page);
    return page.evaluate(async ([url, nonce, body]) => {
        const r = await fetch(`${url}/wp-json/wp/v2/pages`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!r.ok)
            return null;
        const j = await r.json();
        return { id: j.id, link: j.link };
    }, [STAGING.url, nonce, { title: args.title, content: args.content, status: 'publish' }]);
}
async function deletePage(page, id) {
    const nonce = await getRestNonce(page);
    await page.evaluate(async ([url, nonce, id]) => {
        await fetch(`${url}/wp-json/wp/v2/pages/${id}?force=true`, {
            method: 'DELETE',
            credentials: 'include',
            headers: { 'X-WP-Nonce': nonce },
        });
    }, [STAGING.url, nonce, id]);
}
/** Common BetterDocs Gutenberg block payloads. */
const BLOCKS = {
    categoryGrid: '<!-- wp:betterdocs/categorygrid /-->',
    categoryBox: '<!-- wp:betterdocs/categorybox /-->',
    archiveList: '<!-- wp:betterdocs/archive-list /-->',
    faq: '<!-- wp:betterdocs/faq /-->',
    sidebar: '<!-- wp:betterdocs/sidebar /-->',
    searchBox: '<!-- wp:betterdocs/searchbox /-->',
    socialShare: '<!-- wp:betterdocs/social-share /-->',
    reactions: '<!-- wp:betterdocs/reactions /-->',
    readingTime: '<!-- wp:betterdocs/reading-time /-->',
    tableOfContents: '<!-- wp:betterdocs/table-of-contents /-->',
    feedbackForm: '<!-- wp:betterdocs/feedback-form /-->',
};

const SHORTCODES = {
    categoryGrid: '[betterdocs_category_grid]',
    categoryBox: '[betterdocs_category_box]',
    categoryGrid3: '[betterdocs_category_grid_3]',
    relatedDocs: '[betterdocs_related_docs]',
    docsArchive: '[betterdocs_docs_archive]',
    faq: '[betterdocs_faq]',
};

module.exports = { BLOCKS, SHORTCODES, createPageWithContent, deletePage };

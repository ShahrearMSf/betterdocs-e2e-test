/**
 * Staging environment.
 *
 * All credentials and the base URL must be supplied via environment variables
 * (typically loaded from a local, gitignored `.env` file — see `.env.example`).
 * No real credentials are committed to the repo.
 */
exports.SETTINGS_TABS = exports.TIER = exports.PLUGINS = exports.AUTHOR_USER = exports.STAGING = void 0;
function required(name) {
    const v = process.env[name];
    if (!v) {
        throw new Error(`Missing required env var ${name}. Copy .env.example to .env and fill it in.`);
    }
    return v;
}
exports.STAGING = {
    url: process.env.STAGING_URL || required('STAGING_URL'),
    user: process.env.STAGING_USER || required('STAGING_USER'),
    pass: process.env.STAGING_PASS || required('STAGING_PASS'),
};
/**
 * Author-role user used by the 02f Access & Restrictions deep tests
 * (with the User Switching plugin on staging).
 */
exports.AUTHOR_USER = {
    login: process.env.STAGING_AUTHOR_LOGIN || required('STAGING_AUTHOR_LOGIN'),
    pass: process.env.STAGING_AUTHOR_PASS || required('STAGING_AUTHOR_PASS'),
};
/**
 * Plugin slugs by activation tier.
 * Activation order matters — Essential Blocks before Chatbot, Free before Pro, etc.
 */
exports.PLUGINS = {
    essentialBlocks: 'essential-blocks/essential-blocks.php',
    betterdocs: 'betterdocs/betterdocs.php',
    betterdocsPro: 'betterdocs-pro/betterdocs-pro.php',
    betterdocsAiChatbot: 'betterdocs-ai-chatbot/betterdocs-ai-chatbot.php',
    elementor: 'elementor/elementor.php',
    elementorPro: 'elementor-pro/elementor-pro.php',
    eaForElementor: 'essential-addons-for-elementor/essential-addons-elementor.php',
    eaForElementorLite: 'essential-addons-for-elementor-lite/essential_adons_elementor.php',
};
exports.TIER = {
    free: [exports.PLUGINS.essentialBlocks, exports.PLUGINS.betterdocs],
    pro: [exports.PLUGINS.essentialBlocks, exports.PLUGINS.betterdocs, exports.PLUGINS.betterdocsPro],
    chatbot: [exports.PLUGINS.essentialBlocks, exports.PLUGINS.betterdocs, exports.PLUGINS.betterdocsPro, exports.PLUGINS.betterdocsAiChatbot],
};
/**
 * Settings tabs the suite must visit.
 * Keys match what shows in `.wprf-tab-nav-item` text.
 */
exports.SETTINGS_TABS = [
    { tab: 'General', tierRequired: 'free' },
    { tab: 'Layout', tierRequired: 'free' },
    { tab: 'Design', tierRequired: 'free' },
    { tab: 'Shortcodes', tierRequired: 'free' },
    { tab: 'Access & Restrictions', tierRequired: 'pro' },
    { tab: 'Git Sync', tierRequired: 'pro' },
    { tab: 'Email Reporting', tierRequired: 'free' },
    { tab: 'Instant Answer', tierRequired: 'free' },
    { tab: 'AI Content Suite', tierRequired: 'free' },
    { tab: 'AI Chatbot', tierRequired: 'chatbot' },
    { tab: 'Migration', tierRequired: 'pro' },
    { tab: 'Import / Export', tierRequired: 'free' },
    { tab: 'License', tierRequired: 'free' },
];

<a id="readme-top"></a>

<br />
<div align="center">
  <a href="https://betterdocs.co">
    <img src="https://betterdocs.co/wp-content/uploads/2023/08/Better-docs-logo-Fill.svg" alt="Logo" width="80" height="80">
  </a>

  <h3 align="center">BetterDocs E2E Test Automation (Admin Suite)</h3>

  <p align="center">
    Full admin-end Playwright test suite for the BetterDocs plugin ecosystem
  </p>
</div>

## About The Project

[BetterDocs](https://betterdocs.co) is a WordPress knowledge base plugin used to build docs sites, FAQs, glossaries, and AI-powered chatbots. This repo runs **end-to-end QA against the live staging site** — exercising the full admin surface (settings tabs, taxonomies, CRUD, Access & Restrictions, Pro features, AI Chatbot) plus frontend rendering across themes — in a single resilient run.

It complements the [`betterdocs-e2e-fe`](https://github.com/ShahrearMSf/betterdocs-e2e-fe) suite (frontend-only / no-auth) by covering everything an administrator can do.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Built With

* Node.js (22 LTS)
* Playwright (JavaScript)
* WordPress REST API + Admin UI driving

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Getting Started

### Prerequisites

- Node.js 22 LTS
- npm
- A live WordPress staging site with BetterDocs Free + Pro + AI Chatbot (and optionally [User Switching](https://wordpress.org/plugins/user-switching/) for Access & Restrictions tests) installed and licensed

### Installation

1. Clone the repo
   ```sh
   git clone <repo-url>
   cd betterdocs-e2e-test
   ```
2. Install dependencies
   ```sh
   npm install
   ```
3. Install Playwright browsers
   ```sh
   npx playwright install --with-deps chromium
   ```
4. Create `.env` and fill in your staging credentials
   ```sh
   cp .env.example .env
   ```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Usage

```sh
# Run the full 182-test suite (all 5 tier projects in order)
npx playwright test --config=playwright.staging.config.js

# Run a single tier (still respects upstream dependencies)
npx playwright test --config=playwright.staging.config.js --project=tier2-pro

# Filter tests by name
npx playwright test --config=playwright.staging.config.js --grep "02f"

# Show the HTML report
npx playwright show-report playwright-report-staging
```

A clean full run takes **~30 minutes** on a single worker against a live tastewp/Cloudflare-fronted staging site. The suite is intentionally serial — tier projects share site state.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Project Structure

```
playwright/
├── helpers/staging/             # Shared utilities
│   ├── auth.js                  # loginAsAdmin, loginAsUser, userSwitchTo, getRestNonce
│   ├── env.js                   # STAGING, AUTHOR_USER (all from env vars)
│   ├── frontend.js              # visitFrontend, newGuestPage (with network retries)
│   ├── plugins.js               # setTier(free | pro | chatbot)
│   ├── records.js               # REST CRUD: docs, categories, tags, KBs, FAQs, glossaries
│   ├── screenshot.js            # shoot() — dismisses promo banners, waits for render
│   └── settings.js              # setMultipleKb, listSettingsTabs, logRename
└── tests/staging/               # 22 spec files
    ├── 00-setup.spec.js                  # Activate licenses, sanity-check admin (3)
    ├── 01-tier1-free.spec.js             # Dashboard, All Docs, settings tabs, Cats/Tags/Docs CRUD, FAQ, Glossary (14)
    ├── 01b-tier1-extended.spec.js        # Blocks render, shortcodes render, per-tab functional (12)
    ├── 01c-blocks-depth.spec.js          # Every BetterDocs Gutenberg block individually (15)
    ├── 01d-shortcodes-depth.spec.js      # Every BetterDocs shortcode individually (10)
    ├── 01e-settings-deep.spec.js         # Toggle round-trip for every setting key (33)
    ├── 01f-frontend-interactions.spec.js # Search modal, reactions, TOC, breadcrumb, share, print (7)
    ├── 01g-layouts.spec.js               # 10 Single-Doc layouts + 3 Archive layouts (14)
    ├── 01h-permalink-structures.spec.js  # plain, day-name, post-name, numeric, custom (7)
    ├── 01i-edge-cases.spec.js            # Long titles, non-ASCII, drafts, password-protected (7)
    ├── 02-tier2-pro.spec.js              # Pro settings tabs, MKB, Analytics, A&R, Git Sync, License (9)
    ├── 02b-tier2-extended.spec.js        # Related Docs, A&R smoke, Migration, Import/Export (7)
    ├── 02c-roles.spec.js                 # Subscriber/Editor/Contributor/Guest visibility (5)
    ├── 02d-mkb-deep.spec.js              # Multiple KBs end-to-end (5)
    ├── 02e-elementor-widgets.spec.js     # Elementor editor loads + widgets in panel (3)
    ├── 02f-access-restrictions-deep.spec.js  # Advanced (User Switching) + Simple A&R modes (6)
    ├── 02g-faq-glossary-frontend.spec.js  # FAQ + FAQ Group + Glossary frontend rendering (5)
    ├── 03-tier3-chatbot.spec.js          # Chatbot admin pages, logs gating, REST namespace (5)
    ├── 03b-tier3-extended.spec.js        # Logs page, REST namespace, settings round-trip, assets (4)
    ├── 03c-chatbot-conversation.spec.js  # REST query-post, bubble click, send message, history (4)
    ├── 04-themes-matrix.spec.js          # TT2024, TT2025, Hello Elementor, TT2021, Astra (5)
    └── 99-cleanup.spec.js                # Nuke QA-* posts, disable MKB, deactivate plugins (3)
```

**Total: 182 tests across 22 files**

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## What We Test

### Tier 1 · Free (114 tests)
- **Admin shell** — BetterDocs Dashboard loads, all admin menu items reachable
- **All Docs list** — grid/list/classic view modes, every WP screen renders without fatal
- **Settings tabs inventory** — every tab (General, Layout, Design, Shortcodes, Email Reporting, Instant Answer, AI Content Suite, Migration, Import/Export, License) opens and screenshots cleanly
- **Per-setting round-trip** — 33 individual setting keys are toggled via REST, read back, and restored
- **Taxonomies** — categories and tags created via REST + admin UI verification
- **Docs CRUD** — docs created with category+tag assignments, verified in admin list and on frontend as a guest
- **FAQ Builder** — FAQ posts created via REST, verified in admin list
- **Glossary** — Glossary entries created, verified in admin list and on a shortcode-mounted page
- **Every Gutenberg block** — 15 BetterDocs blocks each mounted on a published page and verified to render without fatal
- **Every shortcode** — 10 shortcodes each mounted on a published page and smoke-checked
- **Frontend interactions** — search modal opens + accepts query, reactions, TOC, breadcrumb, social-share, reading-time, print
- **Single Doc layouts** — 10 layout variants tested, plus 3 Archive layouts
- **Permalink structures** — `plain`, `day-name`, `month-name`, `post-name`, `numeric`, `custom` — each set, then `/docs/` is verified to not 404
- **Edge cases** — very long titles, non-ASCII (Bengali) titles, hierarchical parent/child categories, docs without category, draft visibility, password-protected docs

### Tier 2 · Pro (34 tests)
- **Pro settings tabs** — Access & Restrictions, Git Sync, Migration, License screens load
- **Multiple Knowledge Base (MKB)** — toggle via REST + admin UI fallback, create multiple KBs, scope categories + docs to each
- **Access & Restrictions — advanced mode** — admin restricts a category/KB to admin-only role, then uses the **User Switching** plugin to impersonate an Author user and verifies the Author is blocked from the restricted doc but can still see open docs in other categories
- **Access & Restrictions — simple mode** — admin restricts content to *logged-in users only*, an incognito guest browser is verified to be blocked, then an Author login is verified to pass the gate
- **Negative case** — guest can still see unrestricted docs while a restriction is in place (no over-broad blocking)
- **Archive filtering** — restricted doc titles do NOT leak into the public `/docs/` archive
- **Per-role visibility** — Subscriber (blocked from settings), Editor (can edit docs), Contributor (sees Submit for Review), guest (blocked from wp-admin)
- **Elementor widget panel** — Elementor editor loads, BetterDocs widgets appear in the panel and pass keyword search
- **FAQ frontend** — FAQ shortcode rendering on a custom page + admin list verification
- **FAQ Group** — group taxonomy term created, FAQ assigned to it, group-scoped shortcode rendering verified
- **Glossary frontend** — Glossary shortcode rendering + single-term page resolution

### Tier 3 · AI Chatbot (13 tests)
- **Chatbot admin pages** — landing page, AI Chatbot settings tab, AI Chatbot Logs gating
- **Frontend bubble** — chat launcher appears on `/docs/` single pages
- **REST namespace** — `betterdocs-chatbot/v1` is registered
- **Settings round-trip** — `enable_ai_chatbot` toggle persists
- **Frontend assets** — chatbot CSS/JS are enqueued on doc pages when enabled
- **Conversation endpoint** — REST `query-post` is reachable; "Missing configuration" 500 (no API key) is recognized as expected, not a regression
- **History page** — admin chatbot history page slug resolves

### Themes (5 tests)
- **Theme matrix** — frontend `/docs/` archive renders without fatal under Twenty Twenty-Four (FSE), Twenty Twenty-Five (FSE), Hello Elementor (theme-builder), Twenty Twenty-One (legacy customizer), Astra (legacy)

### Cleanup (3 tests)
- **Nuke QA-* posts** — every doc/FAQ/glossary created during the run, identified by `QA-`-prefixed titles, is force-deleted via REST
- **Disable Multiple KB** — return MKB toggle to off
- **Deactivate all plugins** — return the staging site to a clean baseline

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Resilience Patterns

The suite runs against a live, third-party-hosted staging site behind Cloudflare — so it has to tolerate UI drift, occasional network blips, and varying plugin REST shapes across builds. Patterns it uses:

- **Rename log instead of hard fail.** When a UI label changes (e.g. *Write with AI* → *Define with AI*), the suite logs the drift to `staging-renames-report.json` and keeps running. Only true regressions surface as red.
- **Multi-shape REST writes.** Settings POSTs send both `{ settings: {...} }` and flat shapes so older and newer plugin builds both persist values.
- **Admin-UI fallbacks.** Where a REST endpoint isn't exposed (e.g. the `knowledge_base` taxonomy create), the helpers fall back to driving the `edit-tags.php` form.
- **Network-blip retries.** `loginAsAdmin`, `gotoAdmin`, and `visitFrontend` each retry up to 3 times, so transient `ERR_NETWORK_CHANGED` and `chrome-error://chromewebdata/` failures don't tear down whole dependent tiers.
- **Noise dismissers in screenshots.** Every `shoot()` call auto-dismisses Elementor onboarding tooltips, BetterDocs Pro promo banners, WPML/license notices, and chat-bubble overlays before capture.
- **Graceful degradation.** When a feature can't be enabled (e.g. MKB toggle doesn't stick), dependent tests fall back to category-only assertions rather than failing.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Configuration

The `playwright.staging.config.js` file defines five tier projects with a strict dependency chain:

```
00-setup → tier1-free → tier2-pro → tier3-chatbot → themes → 99-cleanup
```

If an upstream tier fails, downstream tests are marked "did not run" rather than being executed against an inconsistent state. Other notable settings:

| Setting | Value | Why |
| --- | --- | --- |
| `workers` | `1` | Tier projects share live site state |
| `fullyParallel` | `false` | Same — order matters within a tier |
| `video` | `retain-on-failure` | Keeps the report lean for green runs |
| `trace` | `retain-on-failure` | Same — debug only failures |
| `screenshot` | `on` | Every test screenshots key moments for visual storytelling |
| `timeout` | `5 min/test` | Some Pro REST endpoints are slow under Cloudflare load |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Required Environment Variables

All credentials and the base URL must come from a local, gitignored `.env`. Required keys:

| Key | Purpose |
| --- | --- |
| `STAGING_URL` | Base URL of the live staging WordPress site |
| `STAGING_USER` | Admin login (email or username) |
| `STAGING_PASS` | Admin password |
| `STAGING_AUTHOR_LOGIN` | Author-role user for 02f Access & Restrictions tests |
| `STAGING_AUTHOR_PASS` | Author password |

The 02f tests additionally require the **User Switching** WordPress plugin to be active on the staging site.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Outputs

- **HTML report** — `playwright-report-staging/index.html` (pass/fail summary, screenshots, videos on failure, full Playwright traces)
- **Rename log** — `staging-renames-report.json` (drifted UI labels / REST endpoints captured during the run)
- **Per-test artifacts** — `test-results-staging/<test-name>/` (screenshots + video + trace on failure)

All outputs are gitignored.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

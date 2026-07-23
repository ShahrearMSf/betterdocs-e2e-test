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

[BetterDocs](https://betterdocs.co) is a WordPress knowledge base plugin used to build docs sites, FAQs, glossaries, and AI-powered chatbots. This repo runs **end-to-end QA against the live staging site** — exercising the full admin surface (settings tabs, taxonomies, CRUD, Access & Restrictions, Pro features, WooCommerce Product FAQ, AI Chatbot, Write with AI, Advanced Analytics) plus frontend rendering across themes — in a single resilient run. It also ships a **version-compatibility matrix** that detects "React chunk mismatch" style design failures across Free + Pro + Chatbot version combos.

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
- A live WordPress staging site with BetterDocs Free + Pro + AI Chatbot + WooCommerce (and optionally [User Switching](https://wordpress.org/plugins/user-switching/) for Access & Restrictions tests) installed and licensed

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
# Run the full 247-test suite (all 7 projects in order)
npx playwright test --config=playwright.staging.config.js

# Run a single project (still respects upstream dependencies)
npx playwright test --config=playwright.staging.config.js --project=tier2-pro

# Filter tests by name
npx playwright test --config=playwright.staging.config.js --grep "02f"

# Run only the compat matrix against the currently-active plugin versions
npx playwright test --config=playwright.staging.config.js --project=compat-matrix

# Read the compat-matrix results (compact table + optional cell-vs-cell diff)
node scripts/matrix-report.js
node scripts/matrix-report.js --diff <baseline-cell> <candidate-cell>

# Show the HTML report
npx playwright show-report playwright-report-staging
```

A clean full run takes **~50 minutes** on a single worker against a live tastewp/Cloudflare-fronted staging site. The suite is intentionally serial — tier projects share site state. The first login solves a "Prove Your Humanity" CAPTCHA once and persists cookies to `.auth/admin.json` via a global setup, so every subsequent test skips the login flow entirely.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Project Structure

```
playwright/
├── global-setup.js              # Solves CAPTCHA + logs in ONCE per run → .auth/admin.json
├── helpers/staging/             # Shared utilities
│   ├── analytics.js             # fireView, fireReaction, fireSearch, runRollup, readReport
│   ├── auth.js                  # loginAsAdmin (with CAPTCHA solver + Chrome-autofill guard),
│   │                            # loginAsUser, userSwitchTo, getRestNonce
│   ├── blocks.js                # BLOCKS + SHORTCODES fixtures, createPageWithContent
│   ├── compatMatrix.js          # probeSurface, readAdminNotices, derive (silent-break detection)
│   ├── env.js                   # STAGING, AUTHOR_USER, PLUGINS, MODERN_ADMIN_SLUGS
│   ├── frontend.js              # visitFrontend, newGuestPage (explicit no-cookie state)
│   ├── media.js                 # uploadTinyPng, deleteAttachment (REST)
│   ├── plugins.js               # setTier(free | freeWithWc | pro | proWithWc | chatbot)
│   ├── records.js               # REST CRUD for docs, categories, tags, KBs, FAQs, glossaries,
│   │                            # Product FAQ groups (with React-modal fallback), WC products
│   ├── screenshot.js            # shoot() — dismisses promo banners, waits for render
│   ├── settings.js              # setBetterdocsToggle + wrappers (enableInstantAnswer,
│   │                            # enableAiChatbot, enableEncyclopedia, enableGlossaries),
│   │                            # setAiChatbotApiKey, logRename (deduped)
│   ├── ui-switch.js             # switchToModernUi, switchToClassicUi, getLastVisitedUiMeta
│   └── writeWithAi.js           # openWriteWithAi, generate, pickSuggestions, keepAndInsert,
│                                # hasGlossaryToggle, getModelPill, hasApiKey
└── tests/staging/               # 30 spec files
    ├── 00-setup.spec.js                        # Login, plugin inventory, activate Free + WC (4)
    ├── 01-tier1-free.spec.js                   # Dashboard, All Docs, settings, cat/tag/doc CRUD on React admin pages (11)
    ├── 01b-tier1-extended.spec.js              # Blocks + shortcodes render, per-tab checks, Instant Answer (12)
    ├── 01c-blocks-depth.spec.js                # Every BetterDocs Gutenberg block individually (16)
    ├── 01d-shortcodes-depth.spec.js            # Every BetterDocs shortcode individually (11)
    ├── 01e-settings-deep.spec.js               # Toggle round-trip for every setting key + revamp keys (34)
    ├── 01f-frontend-interactions.spec.js       # Search modal, reactions, TOC, breadcrumb, share, print (8)
    ├── 01g-layouts.spec.js                     # 10 Single-Doc layouts + 3 Archive layouts (14)
    ├── 01h-permalink-structures.spec.js        # Every permalink structure vs /docs/ (7)
    ├── 01i-edge-cases.spec.js                  # Long titles, non-ASCII, drafts, password-protected (7)
    ├── 01j-ui-switch.spec.js                   # "Switch to BetterDocs UI" ↔ "Switch to Classic UI" (8)
    ├── 01k-write-with-ai.spec.js               # Write with AI modal, Prompt generate, Keep & Insert,
    │                                           # Edit-with-AI, Summary, no-key path, model config,
    │                                           # From Git (Pro-gated) (12)
    ├── 02-tier2-pro.spec.js                    # Pro settings tabs, React MKB page, doc lifecycle (9)
    ├── 02b-tier2-extended.spec.js              # Related Docs, A&R smoke, Migration, Import/Export (7)
    ├── 02c-roles.spec.js                       # Subscriber/Editor/Contributor/Guest visibility (5)
    ├── 02d-mkb-deep.spec.js                    # Multiple KBs end-to-end (5)
    ├── 02e-elementor-widgets.spec.js           # Elementor editor loads + widgets in panel (3)
    ├── 02f-access-restrictions-deep.spec.js    # Advanced (User Switching) + Simple A&R modes (6)
    ├── 02g-faq-glossary-frontend.spec.js       # FAQ + FAQ Group + Glossary frontend (5)
    ├── 02h-product-faq.spec.js                 # WooCommerce Product FAQ end-to-end: create group
    │                                           # linked to product, verify FAQ tab + placement (4)
    ├── 02i-analytics-deep.spec.js              # Advanced Analytics v1 — tabs, auth gating,
    │                                           # ingest → rollup → converge, live reactions,
    │                                           # nonce-gated feedback, zero-result search,
    │                                           # CSV formula-injection safety, retention,
    │                                           # cookieless, bot-exclusion, Free/Pro degrade (17)
    ├── 03-tier3-chatbot.spec.js                # Chatbot admin, IA precondition (bubble absent
    │                                           # when IA off; present when both on) (6)
    ├── 03b-tier3-extended.spec.js              # Logs page, REST namespace, settings, assets (4)
    ├── 03c-chatbot-conversation.spec.js        # IA modal → 2nd tab → guest → "hi" → no-key notice (4)
    ├── 03d-chatbot-no-api-key.spec.js          # AI Chatbot settings warning when IA off, empty key (2)
    ├── 04-themes-matrix.spec.js                # TT2024, TT2025, Hello Elementor, TT2021, Astra (5)
    ├── 04-themes-encyclopedia-fse.spec.js      # /encyclopedia/ under FSE themes (2)
    ├── 04-themes-encyclopedia-elementor.spec.js # /encyclopedia/ under Hello Elementor (1)
    ├── 05-compat-matrix.spec.js                # 12 admin+frontend surfaces × health signals
    │                                           # → silent_break detection (13)
    └── 99-cleanup.spec.js                      # Nuke QA-* posts + Product FAQ groups,
                                                # reset revamp toggles, deactivate plugins (4)
scripts/
└── matrix-report.js             # CLI reporter for compat-matrix.json
                                 #   node scripts/matrix-report.js
                                 #   node scripts/matrix-report.js --json
                                 #   node scripts/matrix-report.js --cell <label>
                                 #   node scripts/matrix-report.js --diff <a> <b>
```

**Total: 247 tests across 30 files**

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## What We Test

### Setup (4 tests)
- Admin login, admin-email interstitial dismissal, plugin inventory, Free-tier activation, WooCommerce activation with product-catalogue smoke check

### Tier 1 · Free (143 tests)
- **Admin shell** — Dashboard, All Docs, view-mode toggles
- **Modern React admin pages** — Doc Categories, Doc Tags, FAQ Builder, Glossaries, MKB — verified as the primary path; classic `edit-tags.php` is a `logRename`-guarded fallback
- **"Switch to BetterDocs UI" ↔ "Switch to Classic UI"** — full round-trip across 4 screens, `last_visited_docs_admin_page` user-meta persistence
- **Settings tabs** — every tab opens, per-key toggle round-trip (34 keys, including the revamp keys `enable_disable`, `enable_ai_chatbot`, `enable_encyclopedia`, `enable_glossaries`)
- **CRUD lifecycles** — docs, categories, tags with frontend verification and cleanup
- **Content coverage** — every Gutenberg block, every shortcode, all 10 Single-Doc layouts + 3 Archive layouts
- **Permalink structures** — plain, day/month/postname, numeric, custom
- **Edge cases** — long titles, non-ASCII (Bengali) slugs, hierarchical categories, drafts, password-protected
- **Write with AI** — modal opens, tabs (Prompt / From source / From Git), model pill, generation, suggestion picker (categories + tags only — glossaries removed), Keep & insert, Edit-with-AI, Article Summary, graceful no-API-key fallback

### Tier 2 · Pro (60 tests)
- **Pro settings tabs** — Access & Restrictions, Git Sync, Migration, License
- **Multiple Knowledge Base (MKB)** — React admin page (`betterdocs-knowledge-base`) as primary path, classic fallback
- **Access & Restrictions** — advanced (per-role via User Switching) + simple (guest-blocked) modes, archive filtering, negative cases
- **Per-role visibility** — Subscriber / Editor / Contributor / Guest
- **Elementor widget panel** — editor loads, BetterDocs widgets visible
- **FAQ + FAQ Group + Glossary** — frontend rendering via shortcode + single-term archives
- **WooCommerce Product FAQ** — create group linked to a WC product (with React-modal fallback when REST rejects), attach a FAQ, verify it renders in the product page's "FAQ" tab (`Description | Additional Information | Reviews | FAQ`), verify inline placement (`after_summary`)
- **Advanced Analytics v1** — tab shell (Overview / Doc Performance / Reactions / Search Analytics / Reader Engagement / Feedback Inbox / Link Health / Author Performance), REST auth gating (guests get 401), view ingest → wp-cron rollup → aggregated read, live reactions, nonce-gated feedback, zero-result search, CSV export with formula-injection neutralization, retention keep-forever default, cookieless mode, `exclude_bot_analytics` mirroring, Free/Pro degradation, legacy-vs-new data parity

### Tier 3 · AI Chatbot (16 tests)
- **Admin shell** — chatbot page, AI Chatbot settings tab, logs gating
- **Instant Answer precondition** — bubble absent from `/docs/` when IA is off, present when IA + chatbot are both on
- **REST namespaces** — `betterdocs-pro/v1/query-post` reachable, "not currently available" no-key response recognized (not a regression)
- **Conversation flow (via IA modal)** — guest visits `/docs/`, opens Instant Answer, switches to 2nd tab (Chatbot), continues as guest, sends "hi", asserts a failure notice appears when the API key is empty
- **No-API-key admin surface** — AI Chatbot settings tab renders warning when IA off, key-valid marker absent when key cleared

### Themes (8 tests)
- **Full theme matrix** — TT2024 (FSE), TT2025 (FSE), Hello Elementor (theme-builder), TT2021 (legacy customizer), Astra (legacy) — each activated in turn, frontend `/docs/` verified
- **Encyclopedia routing** — `/encyclopedia/` under FSE themes (TT2024, TT2025) and under Hello Elementor

### Compat Matrix (13 tests)
- **12 canonical surfaces** — Dashboard, Doc Categories, Doc Tags, FAQ WooCommerce groups, Glossaries, Multiple KB, Analytics, Settings AI-Chatbot tab, frontend `/docs/`, `/encyclopedia/`, WC product page
- **Per surface health signals** — SPA root height, visible-button count, JS console errors (chunk-load detection), fatal PHP, admin notices on this surface, admin notices on `plugins.php`
- **Derived `silent_break` flag** — TRUE when a surface is visibly broken AND no compatibility notice explains why. Exactly the "Free X + Pro Y with mismatched React chunks, no explanation to the user" failure mode
- **Cell-by-cell diff** — `scripts/matrix-report.js --diff` prints per-surface deltas between two plugin-version cells (regressed / fixed / same-broken / same-ok)

### Cleanup (4 tests)
- **Nuke QA-* posts** — every doc/FAQ/glossary/Product-FAQ-group created during the run
- **Reset revamp toggles** — Multiple KB, Instant Answer, AI Chatbot, Encyclopedia, Glossaries
- **Deactivate all plugins** — return the staging site to a clean baseline

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Resilience Patterns

The suite runs against a live, third-party-hosted staging site behind Cloudflare — so it has to tolerate UI drift, CAPTCHA challenges, occasional network blips, and varying plugin REST shapes across builds. Patterns it uses:

- **Global-setup login + storage-state reuse.** `playwright/global-setup.js` performs one authenticated login at the start of every run — solving any "Prove Your Humanity" math CAPTCHA the host might interpose — and persists cookies to `.auth/admin.json`. Every test consumes those cookies via `use.storageState`, so no test hits wp-login on the happy path. Cut per-test overhead from ~30 s to ~1 s.
- **Guest contexts explicit.** `newGuestPage()` passes `{ storageState: undefined }` so admin cookies don't leak into negative-path tests ("guest can't reach wp-admin", etc.).
- **Chrome-autofill-proof credential fill.** The login helper re-writes user + password via JS-level `set('value', …)` immediately before submitting, bypassing Chrome's autofill from wiping the password field mid-flight.
- **CAPTCHA guard.** The math-CAPTCHA solver refuses to run on any page that also contains the wp-login form, so a stray "Prove your humanity" mention in a plugin banner can't accidentally trip a submit-with-empty-password.
- **Rename log instead of hard fail.** When a UI label changes (e.g. *Write with AI* → *Define with AI*), the suite logs the drift to `staging-renames-report.json` (deduped) and keeps running. Only true regressions surface as red.
- **Multi-shape REST writes + admin-UI fallbacks.** Settings POSTs send both `{ settings: {...} }` and flat shapes. Product FAQ Group creation tries public REST, plugin-namespaced REST, and finally drives the React modal ("Create a New Product FAQ Group") when none stick.
- **Network-blip retries.** `loginAsAdmin`, `gotoAdmin`, and `visitFrontend` each retry up to 3 times so transient `ERR_NETWORK_CHANGED` / `chrome-error://chromewebdata/` failures don't tear down whole dependent tiers.
- **Noise dismissers in screenshots.** Every `shoot()` call auto-dismisses Elementor onboarding tooltips, BetterDocs promo banners, WPML notices, and chat-bubble overlays before capture.
- **`only-on-failure` screenshots + video + trace.** Green tests don't waste disk. Failed tests keep a full trace zip and MP4.
- **Non-serial chatbot tests.** `03-tier3` uses `test.describe` (not `.serial`) so an environmental flake on one test doesn't skip the rest of the file.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Configuration

The `playwright.staging.config.js` file defines seven projects with a strict dependency chain:

```
00-setup ─┬─ tier1-free ─ tier2-pro ─┬─ tier3-chatbot
          │                          │
          │                          └─ themes ─ 99-cleanup
          │
          └─ compat-matrix   (independent — samples current live versions)
```

`compat-matrix` and `99-cleanup` no longer depend on `tier3-chatbot`, so a chatbot flake never skips downstream projects. Other notable settings:

| Setting | Value | Why |
| --- | --- | --- |
| `workers` | `1` | Tier projects share live site state |
| `fullyParallel` | `false` | Same — order matters within a tier |
| `globalSetup` | `playwright/global-setup.js` | One login per run, cookies persisted to `.auth/admin.json` |
| `use.storageState` | `.auth/admin.json` (unconditional) | Reuse the persisted admin session across every test |
| `video` | `retain-on-failure` | Keeps the report lean for green runs |
| `trace` | `retain-on-failure` | Debug only failures |
| `screenshot` | `only-on-failure` | Reduced disk pressure and wall-time |
| `timeout` | `10 min/test` | Some Pro REST endpoints are slow under Cloudflare load |
| `retries` | `2 in CI, 0 locally` | Live-site transients get one retry in CI, none locally |

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

- **HTML report** — `playwright-report-staging/index.html` (pass/fail summary, screenshots + video + trace on failure)
- **Rename log** — `staging-renames-report.json` (drifted UI labels / REST endpoints, deduped per run)
- **Compat matrix** — `compat-matrix.json` (rows per surface × plugin-version cell) + `test-results-staging/compat-matrix/<cell>/*.png` (screenshots per cell)
- **Per-test artifacts** — `test-results-staging/<test-name>/` (screenshot + video + trace only on failure)

All outputs are gitignored (`.env`, `.auth/`, `test-results-staging/`, `playwright-report-staging/`, `staging-renames-report.json`, `results.json`, `compat-matrix.json`).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Compat Matrix — Silent-Break Detection

The compat-matrix project catches "Free X + Pro Y with mismatched React chunks" failures — the class of design breakage where a plugin surface renders visibly broken (blank container, missing tabs, chunk-load errors in the console) but there's no admin notice explaining the incompatibility to the user.

Each run tags its data rows with the currently-active `(Free + Pro + Chatbot)` version tuple, so accumulating rows across releases builds a matrix. `scripts/matrix-report.js` prints the state and can diff two cells to show regressions:

```sh
node scripts/matrix-report.js
# CELL                     | SURF | BROKEN | SILENT | BROKEN SURFACES
# 4.5.7+3.9.4+main         |  12  |   0    |   0    | -
# 4.6.3+3.9.4+main         |  12  |   3    |   2    | 07-analytics⚠, 09-write-with-ai⚠, 11-frontend-encyclopedia
#
# ⚠ = silent break (surface broken AND no compatibility notice explains why)

node scripts/matrix-report.js --diff 4.5.7+3.9.4+main 4.6.3+3.9.4+main
# regressed=2  fixed=0  same-broken=0  same-ok=10
#  ✗ REGRESSED  07-analytics    root 780→42px, err 0→2, silent n→y
#  ✗ REGRESSED  09-write-with-ai root 620→0px, err 0→1, silent n→y
```

Broken-surface heuristic (both signals must fire — one alone is unreliable):
- SPA root height < 200 px **AND** visible-button count < 3
- OR a JS console error matching `ChunkLoadError|Loading chunk|Cannot find module|is not a function`
- OR a "Fatal error" / "Uncaught" text on the page

`silent_break = broken && no notice matching /requires.*BetterDocs|compat|newer.*version|min.*version/`. Compat notices are collected from the surface itself AND from `plugins.php`, so an "update BetterDocs to 4.6.x" notice on plugins.php properly explains a broken tab-9 surface too.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Latest Validation

**Last known live state on `probettamation.shahrear.msf.bd`** (Free 4.6.3 + Pro 3.9.5 + Chatbot 1.8.1, 2026-07-22):

| Subset | Result | Wall time |
| --- | --- | --- |
| `--project=compat-matrix` (16 tests) | **16/16 pass · 0 silent breaks** | 3.1 min |
| `--grep "02i"` (17 analytics tests + tier1 dep walk = 163 executions) | **152 pass · 0 fail · 11 intentional `test.skip`** | 38.7 min |
| Prior full suite (before analytics fixes) | 189 pass · 1 fail · 2 skipped · 12 did-not-run | 144 min → 44.9 min after storage-state |

The compat-matrix's first recorded cell shows no design failures: every admin/frontend surface either renders a healthy SPA root (dashboard 868 px, doc-categories 1123 px, analytics 1264 px) or produces a legitimate empty state that the tightened heuristic doesn't misread. Both analytics helpers (`fireReaction` payload `feelings: happy|sad|normal`, `fireSearch` GET with `s`+`no_result` query params) are validated end-to-end against the live REST endpoints. Every full-suite attempt has been derailed by transient network hiccups against the msf.bd host somewhere in its ~50-minute window, but every subset that has completed uninterrupted has passed cleanly.

**Wall-time improvements banked in this cycle:**

| Change | Before | After |
| --- | --- | --- |
| Full suite baseline | 144 min | 45 min |
| Per-test login | ~30 s | ~1 s (storage-state) |
| Screenshot policy | on-every-step | on-failure-only |
| logRename output | thousands of dupes | 16 unique per run |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

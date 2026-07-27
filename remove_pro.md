# Remove `Pro` / `Premium` UI Audit And Task List

Audit date: 2026-07-27

Purpose: convert every current `Pro` / `Premium` UI finding into an actionable task. Each item is intentionally phrased so we do one of two things:

1. Remove the `Pro` / `Premium` text from the UI when there is no real end-user feature behind it and the surface is only an upsell.
2. Ship the real feature behind the lock and replace the locked widget / CTA with a working free surface.

Important implementation note:

- Do not edit built bundles under `public/pro/assets/`.
- Edit source files, then rebuild any generated static output.
- When removing gating, remove both the visible copy and the technical gate (`premium: 'locked'`, `premium: 'enhanced'`, `hasPremiumAccess()`, `trackGateHit(...)`, locked CTA wiring, and related locale keys) for that surface.

## Shared Rules

- If a surface is only navigation, branding, or upsell copy, remove the `Pro` / `Premium` language from the UI.
- If a surface already has rendering logic, fetch logic, data models, or a hidden working implementation, keep the feature and ungate it instead of deleting it.
- Prefer fixing the source of truth first:
  - panel config in `src/config/panels.ts`
  - shared panel chrome in `src/components/Panel.ts`
  - shared gating copy in `src/locales/en.shell.json`
  - layer toggle badges in `src/components/DeckGLMap.ts` and `src/components/GlobeMap.ts`
  - settings gating in `src/components/UnifiedSettings.ts`

## Remove-Only Tasks

These are pure upsell or navigation surfaces. They should lose `Pro` / `Premium` wording instead of gaining new features.

### [x] R1. Remove the top dashboard `Pro` promo banner

- Files:
  - `src/components/ProBanner.ts`
  - `src/locales/en.shell.json`
- Current UI:
  - `PRO`
  - `Pro is launched`
  - `More Signal, Less Noise. More AI Briefings. A Geopolitical & Equity Researcher just for you.`
  - `Upgrade to Pro ->`
- Source refs:
  - `src/components/ProBanner.ts:130`
  - `src/locales/en.shell.json:434`
- Task:
  - Remove the banner mount path from the dashboard.
  - Remove the associated locale keys and dismiss-state code if no longer needed.
- Acceptance:
  - No promotional `Pro` banner appears at the top of the app for any user state.

### [x] R2. Remove `Pro` nav links from app chrome and blog chrome

- Files:
  - `src/app/panel-layout.ts`
  - `blog-site/src/layouts/Base.astro`
- Current UI:
  - `Pro` nav/footer links in dashboard mobile menu and footer
  - `Pro` nav/footer links in the blog
- Source refs:
  - `src/app/panel-layout.ts:969`
  - `src/app/panel-layout.ts:1037`
  - `blog-site/src/layouts/Base.astro:111`
  - `blog-site/src/layouts/Base.astro:137`
- Task:
  - Remove the dedicated `Pro` links from app and blog navigation.
  - Remove or rename any CTA that only exists to push users to `/pro`.
- Acceptance:
  - Main product chrome no longer advertises `Pro` as a top-level destination.

### [x] R3. Remove generic `Upgrade to Pro` shell copy from shared locale and accessibility strings

- Files:
  - `src/locales/en.shell.json`
  - `src/components/unified-settings-interactions.ts`
- Current UI:
  - `Sign In to Unlock`
  - `Upgrade to Pro for full access to premium analytics`
  - `Upgrade to Pro`
  - `Free plan: max {{max}} panels. Upgrade to PRO for unlimited.`
  - `Upgrade to Pro to use <panel>`
- Source refs:
  - `src/locales/en.shell.json:260`
  - `src/locales/en.shell.json:790`
  - `src/components/unified-settings-interactions.ts:67`
- Task:
  - Delete or rename shell keys that exist only for premium upsell copy.
  - Replace locked aria labels with neutral action labels once panels are ungated.
- Acceptance:
  - Shared shell copy no longer contains generic premium upsell language.

### [x] R4. Remove the generic locked-panel upgrade CTA from the base panel component

- Files:
  - `src/components/Panel.ts`
- Current UI:
  - shared `PRO` header badge
  - generic `Upgrade to Pro` button on locked panels
- Source refs:
  - `src/components/Panel.ts:232`
  - `src/components/Panel.ts:939`
- Task:
  - Remove generic upsell behavior from the base panel once the remaining gated panels are either ungated or replaced.
  - Remove the default header `PRO` badge behavior from the shared panel chrome.
- Acceptance:
  - Base panel chrome does not inject `PRO` badges or `Upgrade to Pro` buttons on its own.

### [x] R5. Remove the notifications-tab upsell card and replace with neutral onboarding

- Files:
  - `src/services/notifications-settings.ts`
- Current UI:
  - descriptive upsell copy for Telegram / Slack / Discord / Email notifications
  - `Upgrade to Pro`
- Source refs:
  - `src/services/notifications-settings.ts:98`
- Task:
  - Replace the paywall card with either:
    - working notifications setup, if the feature is ready for free users, or
    - neutral "coming soon" / setup-disabled copy with no premium language.
- Acceptance:
  - The notifications tab does not show an upsell-only `Upgrade to Pro` card.

### [x] R6. Remove `Pro` category chips and badge-only labels after unlock work is done

- Files:
  - `src/components/MobilePanelNav.ts`
  - `src/components/DeckGLMap.ts`
  - `src/components/GlobeMap.ts`
  - `src/components/UnifiedSettings.ts`
- Current UI:
  - mobile `⚡ PRO` category
  - map layer `PRO` badges
  - settings panel `PRO` badges
- Source refs:
  - `src/components/MobilePanelNav.ts:56`
  - `src/components/DeckGLMap.ts:5465`
  - `src/components/GlobeMap.ts:1954`
  - `src/components/UnifiedSettings.ts:921`
- Task:
  - Remove badge-only labeling once the underlying gated surfaces are made available.
- Acceptance:
  - No panel, layer, or category is labeled `PRO` purely for merchandising.

## Build / Ungate Real Features

These surfaces already have real feature logic, data structures, or fetch/render code. The job here is to ship the feature publicly and remove the lock copy.

### [x] F1. Ungate stock analysis

- Files:
  - `src/components/StockAnalysisPanel.ts`
  - `src/config/panels.ts`
- Current UI:
  - panel title `Premium Stock Analysis`
  - locked panel via shared premium panel path
- Source refs:
  - `src/components/StockAnalysisPanel.ts:67`
  - `src/config/panels.ts:57`
- Existing functionality behind the lock:
  - full table rendering, sorting, filtering, watchlist integration, signal display
- Task:
  - Rename panel to `Stock Analysis`.
  - Remove `premium: 'locked'`.
  - Ensure loader / fetch path works for non-premium users.
- Acceptance:
  - A free user can open the panel and see real stock analysis data with the existing table UI.

### [x] F2. Ungate stock backtesting

- Files:
  - `src/components/StockBacktestPanel.ts`
  - `src/config/panels.ts`
- Current UI:
  - panel title `Premium Backtesting`
  - locked panel
- Source refs:
  - `src/components/StockBacktestPanel.ts:35`
  - `src/config/panels.ts:58`
- Existing functionality behind the lock:
  - rendered backtest table, filters, win-rate metrics, signal counts
- Task:
  - Rename panel to `Backtesting`.
  - Remove lock config and wire fetches for free access.
- Acceptance:
  - A free user can run the existing backtest view without seeing premium gating.

### [x] F3. Ungate Daily Market Brief

- Files:
  - `src/components/DailyMarketBriefPanel.ts`
  - `src/config/panels.ts`
- Current UI:
  - locked `Daily Market Brief`
- Source refs:
  - `src/components/DailyMarketBriefPanel.ts:48`
  - `src/config/panels.ts:59`
- Existing functionality behind the lock:
  - full brief rendering, timestamps, framework selector, watchlist integration
- Task:
  - Remove panel gating and make the brief available to free users.
- Acceptance:
  - The panel renders a real brief instead of a lock screen.

### [x] F4. Ungate WM Analyst chat

- Files:
  - `src/components/ChatAnalystPanel.ts`
  - `src/config/panels.ts`
- Current UI:
  - `WM Analyst` panel locked behind premium
- Source refs:
  - `src/components/ChatAnalystPanel.ts:148`
  - `src/config/panels.ts:60`
- Existing functionality behind the lock:
  - complete chat UI, domain chips, message area, input controls
- Task:
  - Remove the premium lock and make the analyst available publicly.
  - Confirm backend auth assumptions and usage limits are compatible with free access.
- Acceptance:
  - A free user can use the analyst panel end-to-end.

### [x] F5. Ungate Global Procurement

- Files:
  - `src/components/GlobalProcurementPanel.ts`
  - `src/config/panels.ts`
- Current UI:
  - locked `Global Procurement` panel
- Source refs:
  - `src/components/GlobalProcurementPanel.ts:58`
  - `src/config/panels.ts:62`
- Existing functionality behind the lock:
  - filters, pagination, request handling, data badge, loading states
- Task:
  - Remove lock and verify the existing request handler works for public users.
- Acceptance:
  - A free user can search and paginate procurement opportunities.

### [x] F6. Ungate Trade Policy

- Files:
  - `src/config/panels.ts`
  - related loader / RPC surfaces already referenced by app scheduling
- Current UI:
  - locked `Trade Policy` panel
- Source refs:
  - `src/config/panels.ts:63`
- Existing functionality behind the lock:
  - app refresh scheduling and data loading are already wired elsewhere
- Task:
  - Remove gating and ensure all required RPCs are available to free users.
- Acceptance:
  - `Trade Policy` appears as a working panel with live data for free users.

### [x] F7. Ungate Latest Brief

- Files:
  - `src/components/LatestBriefPanel.ts`
  - `src/config/panels.ts`
- Current UI:
  - `Pro required.`
  - `The WorldMonitor Brief is included with the Pro plan. Upgrade to unlock today's issue.`
- Source refs:
  - `src/components/LatestBriefPanel.ts:438`
  - `src/config/panels.ts:74`
- Existing functionality behind the lock:
  - dedicated brief rendering flow, denial handling, refresh hooks
- Task:
  - Remove the Pro-denial state and allow the panel to fetch and render publicly.
- Acceptance:
  - A free user sees the latest brief content, not the Pro-required empty state.

### [x] F8. Ungate WSB Ticker Scanner

- Files:
  - `src/components/WsbTickerScannerPanel.ts`
  - `src/config/panels.ts`
- Current UI:
  - locked `WSB Ticker Scanner`
- Source refs:
  - `src/components/WsbTickerScannerPanel.ts:40`
  - `src/config/panels.ts:107`
- Existing functionality behind the lock:
  - sorting and interactive scanner UI
- Task:
  - Remove the lock and verify public data access works.
- Acceptance:
  - The scanner renders and sorts for free users.

### [x] F9. Ungate AI Market Implications

- Files:
  - `src/components/MarketImplicationsPanel.ts`
  - `src/config/panels.ts`
- Current UI:
  - locked `AI Market Implications`
- Source refs:
  - `src/components/MarketImplicationsPanel.ts:71`
  - `src/config/panels.ts:125`
- Existing functionality behind the lock:
  - implication-chain UI, node interaction, framework selector
- Task:
  - Remove panel lock and validate the downstream analysis fetches for public use.
- Acceptance:
  - Free users can open and interact with implication chains.

### [x] F10. Ungate Regional Intelligence

- Files:
  - `src/components/RegionalIntelligenceBoard.ts`
  - `src/config/panels.ts`
- Current UI:
  - locked `Regional Intelligence`
- Source refs:
  - `src/components/RegionalIntelligenceBoard.ts:76`
  - `src/config/panels.ts:126`
- Existing functionality behind the lock:
  - region selector, board rendering, refresh and entitlement listeners
- Task:
  - Remove the lock and verify the board fetch path works without premium auth.
- Acceptance:
  - The regional board loads for free users with its existing snapshot UI.

### [x] F11. Ungate Route Explorer

- Files:
  - `src/components/RouteExplorer/RouteExplorer.ts`
  - `src/components/RouteExplorer/components/LeftRail.ts`
- Current UI:
  - `Unlock route intelligence`
  - `Upgrade to PRO`
  - `Upgrade to PRO for route intelligence.`
- Source refs:
  - `src/components/RouteExplorer/RouteExplorer.ts:347`
  - `src/components/RouteExplorer/components/LeftRail.ts:75`
- Existing functionality behind the lock:
  - route explorer shell, lane content, left rail
- Task:
  - Remove free-gate rendering and expose the current / alternatives / land / impact workflow to free users.
- Acceptance:
  - A user can run route intelligence without hitting a premium-only gate.

### [x] F12. Ungate Scenario Engine

- Files:
  - `src/components/MapContainer.ts`
  - `src/components/SupplyChainPanel.ts`
- Current UI:
  - scenario activation is blocked and only records `trackGateHit('scenario-engine')`
- Source refs:
  - `src/components/MapContainer.ts:1482`
  - `src/components/SupplyChainPanel.ts:820`
- Existing functionality behind the lock:
  - scenario result application, affected-country visuals, summary rendering
- Task:
  - Remove the premium guard from scenario activation.
  - Expose the existing scenario runner publicly.
- Acceptance:
  - Free users can activate a scenario and see map + supply-chain updates.

### [x] F13. Ungate bypass corridors in supply-chain and country detail views

- Files:
  - `src/components/SupplyChainPanel.ts`
  - `src/components/CountryDeepDivePanel.ts`
- Current UI:
  - `Bypass corridors available with PRO`
- Source refs:
  - `src/components/SupplyChainPanel.ts:257`
  - `src/components/CountryDeepDivePanel.ts:1990`
- Existing functionality behind the lock:
  - bypass option fetch, top-3 route rendering, added days / cost / risk table
- Task:
  - Remove gate markup and always render the actual bypass options table.
- Acceptance:
  - Free users can see bypass corridor alternatives anywhere the app already computes them.

### [x] F14. Ungate country deep-dive premium cards

- Files:
  - `src/components/CountryDeepDivePanel.ts`
- Current UI:
  - `Upgrade to PRO for multi-sector cost shock modelling`
  - `Upgrade to PRO for product import data`
  - `Upgrade to PRO for national debt data`
  - `Upgrade to PRO for sanctions data`
  - `Upgrade to PRO for trade flow data`
  - `Upgrade to PRO for tariff trend data`
- Source refs:
  - `src/components/CountryDeepDivePanel.ts:2577`
- Existing functionality behind the lock:
  - actual card containers, loading states, data-specific sections
- Task:
  - Replace each locked card body with live data loading for free users.
  - Keep the existing widget shapes and titles.
- Acceptance:
  - These cards load real data instead of lock placeholders.

### [x] F15. Ungate evidence export

- Files:
  - `src/components/CountryDeepDivePanel.ts`
  - `src/components/CountryBriefPage.ts`
- Current UI:
  - `Export evidence bundle as Markdown (PRO)`
  - toast: `Evidence export is available on Pro.`
- Source refs:
  - `src/components/CountryDeepDivePanel.ts:2508`
  - `src/components/CountryBriefPage.ts:749`
- Existing functionality behind the lock:
  - export button and export handler wiring
- Task:
  - Remove the Pro-only click gate and enable Markdown evidence export for all users.
- Acceptance:
  - The Evidence action exports the bundle for free users without showing a premium toast.

### [x] F16. Ungate chokepoint popup widgets

- Files:
  - `src/components/MapPopup.ts`
- Current UI:
  - `PRO` + `Transit History`
  - `PRO` + `Sector Breakdown`
- Source refs:
  - `src/components/MapPopup.ts:1425`
  - `src/components/MapPopup.ts:1444`
- Existing functionality behind the lock:
  - actual transit-chart mount
  - actual HS2 ring / sector exposure rendering
- Task:
  - Remove the gate cards and always mount the real chart / ring widgets.
- Acceptance:
  - Popup shows live transit history and sector breakdown without a lock placeholder.

### [x] F17. Ungate resilience scores

- Files:
  - `src/components/ResilienceWidget.ts`
- Current UI:
  - `Sign in to unlock premium resilience scores.`
  - `Upgrade to Pro to unlock resilience scores.`
- Source refs:
  - `src/components/ResilienceWidget.ts:197`
- Existing functionality behind the lock:
  - preview rendering, score-card UI, CTA wiring
- Task:
  - Replace the locked state with the real score view for free users.
- Acceptance:
  - The resilience widget renders actual scores instead of a lock card.

### [x] F18. Ungate premium/enhanced map layers

- Files:
  - `src/config/panels.ts`
  - `src/components/DeckGLMap.ts`
  - `src/components/GlobeMap.ts`
- Current UI:
  - locked or `PRO`-badged layers in map toggles
- Source refs:
  - `src/config/panels.ts:32`
  - `src/components/DeckGLMap.ts:5457`
  - `src/components/GlobeMap.ts:1944`
- Existing functionality behind the lock:
  - actual layer toggles, actual layer rendering, explanatory tooling
- Task:
  - Remove `premium: 'locked'` and `premium: 'enhanced'` behavior for map layers that already exist.
  - Specifically audit:
    - `AI Forecasts` on desktop
    - `Country Instability`
    - `Strategic Risk Overview`
    - `Live Intelligence`
    - `Supply Chain` enhanced state
    - desktop-only `Israel Sirens`
    - desktop-only `Telegram Intel`
- Acceptance:
  - Map layers are selectable and visible without `PRO` chips or disabled lock states.

## Settings / Account Surface Cleanup

These should be addressed after the real feature ungating work above.

### [x] S1. Remove `PRO` badges from panel settings once panel locks are gone

- Files:
  - `src/components/UnifiedSettings.ts`
- Source refs:
  - `src/components/UnifiedSettings.ts:921`
- Task:
  - Remove `PRO` badges from panel toggles after each gated panel is made available.

### [x] S2. Rework `API Keys` and `MCP Clients` tab labeling

- Files:
  - `src/components/UnifiedSettings.ts`
- Current UI:
  - `API Keys PRO`
  - `MCP Clients PRO`
- Source refs:
  - `src/components/UnifiedSettings.ts:572`
  - `src/components/UnifiedSettings.ts:573`
  - `src/components/UnifiedSettings.ts:1623`
- Task:
  - These are not simple premium upsells; they are separate capability gates.
  - Remove `PRO` labeling from the tab chrome.
  - Keep entitlement-based access if required, but use product-accurate naming.
- Acceptance:
  - These tabs do not mislabel API or MCP access as generic `PRO`.

### [x] S3. Remove the generic settings upgrade cards

- Files:
  - `src/components/UnifiedSettings.ts`
- Current UI:
  - `Upgrade to Pro`
  - `Unlock all panels, AI analysis, and priority data refresh.`
  - `View plans ->`
- Source refs:
  - `src/components/UnifiedSettings.ts:799`
  - `src/components/UnifiedSettings.ts:808`
- Task:
  - Replace the generic upgrade card with neutral settings help, or remove it entirely if no gated settings remain.
- Acceptance:
  - Settings no longer contain a generic premium upsell block.

## Final Cleanup Pass

After the tasks above are done, run a final repo-wide cleanup.

### [x] C1. Remove stale `Pro` / `Premium` names from panels and copy

- Examples to rename:
  - `Premium Stock Analysis`
  - `Premium Backtesting`
- Files:
  - `src/components/StockAnalysisPanel.ts`
  - `src/components/StockBacktestPanel.ts`
  - any matching locale/config entries

### [x] C2. Remove stale premium analytics telemetry and gate tracking where no longer useful

- Files:
  - any remaining `trackGateHit(...)` callers on now-public features
- Task:
  - remove gate-hit instrumentation that no longer represents a real gate

### [x] C3. Sweep remaining strings

- Command to rerun after implementation:

```bash
rg -n --hidden -S '\\bPro\\b|\\bPRO\\b|premium|Upgrade to Pro|Upgrade to PRO|Sign In to Unlock' src public blog-site
```

- Acceptance:
  - only intentional, non-upsell references remain
  - no user-facing `Upgrade to Pro` / `Premium` lock text survives on public product surfaces

## Deep Final Audit Follow-Ups

Audit result: the first-pass UI edits removed many badges and lock cards, but several checked tasks do not yet meet their end-to-end acceptance criteria. The unchecked tasks below were found by tracing panel registration, loader scheduling, server entitlements, localization, generated marketing output, and tests on 2026-07-27.

Intentional paid boundaries that are not part of this follow-up remain allowed: billing / checkout, API and MCP access, custom widget generation, scheduled notification delivery, and partner shipping webhooks. Those surfaces must still use capability-accurate wording and must not claim that the now-public dashboard features are paid.

### [x] D1. Complete Stock Analysis and Backtesting ungating

- Files:
  - `src/app/panel-layout.ts`
  - `src/app/data-loader.ts`
  - `src/App.ts`
  - `src/services/stock-analysis.ts`
  - `src/services/stock-analysis-targets.ts`
  - `tests/stock-analysis-targets.test.mts`
  - `tests/premium-loaders-fan-out-coverage.test.mts`
- Remaining gates:
  - `WEB_PREMIUM_PANELS` still contains `stock-analysis` and `stock-backtest`, so free and anonymous users still receive the shared gate CTA.
  - Watchlist-change refresh and fast-prime loading still run only when `hasPremiumAccess()` is true.
  - Free users are limited to four analysis targets while paid users receive up to 50.
- Task:
  - Remove both panels from all entitlement-gated mount, prime, refresh, and transition paths.
  - Remove tier-aware target selection and analyze the same supported watchlist for every user, subject only to a universal operational safety limit.
  - Replace tests that enforce the four-symbol free cap with public-access coverage.
- Acceptance:
  - Anonymous and signed-in free users can load, refresh, sort, filter, and backtest the same supported watchlist without a gate CTA or reduced tier-specific result set.

### [ ] D2. Complete Daily Market Brief ungating

- Files:
  - `src/app/panel-layout.ts`
  - `src/app/data-loader.ts`
  - `src/App.ts`
  - `src/services/daily-market-brief.ts`
  - `tests/premium-loaders-fan-out-coverage.test.mts`
- Remaining gates:
  - `WEB_PREMIUM_PANELS` still contains `daily-market-brief`.
  - `loadDailyMarketBrief()` returns immediately for non-premium users.
  - Post-hydration, fast-prime, and watchlist refresh paths still require `hasPremiumAccess()`.
  - The persistent cache namespace is still named `premium:daily-market-brief:v1`.
- Task:
  - Remove every entitlement condition from panel mounting and all brief loader entry points.
  - Move the cache to a neutral namespace with a safe migration / fallback for existing cached briefs.
  - Update fan-out tests to assert public loading rather than Pro-only loading.
- Acceptance:
  - The Daily Market Brief builds and refreshes for anonymous and signed-in free users, including watchlist and framework changes.

### [ ] D3. Ungate Deduct Situation and its AI assessment path

- Files:
  - `src/config/panels.ts`
  - `src/components/DeductionPanel.ts`
  - `src/app/panel-layout.ts`
  - `src/app/agent-bus-applier.ts`
  - `src/services/correlation-engine/engine.ts`
  - `src/shared/premium-paths.ts`
  - `server/worldmonitor/intelligence/v1/deduct-situation.ts`
  - `server/_shared/direct-llm-quota.ts`
  - `tests/panel-config-guardrails.test.mjs`
  - `tests/agent-bus-applier.test.mts`
- Remaining gates:
  - `deduction` is the only dashboard panel still registered with `premium: 'locked'`.
  - Panel entitlement checks and the agent bus deny it to free users.
  - Correlation LLM assessments are skipped unless `hasPremiumAccess()` is true.
  - `/api/intelligence/v1/deduct-situation` remains a premium RPC with a handler-level premium check.
- Task:
  - Remove the panel lock, API-key-only panel exception, client gate, and handler premium check.
  - Keep cost protection through signed-in free-user quotas / rate limits rather than a paid-plan requirement.
  - Make framework selection and correlation assessment enrichment available on the same public path.
- Acceptance:
  - A signed-in free user can open Deduct Situation, submit an analysis, receive a result, and receive correlation assessments without an upgrade CTA.

### [ ] D4. Remove free-plan panel and source caps

- Files:
  - `src/config/panels.ts`
  - `src/App.ts`
  - `src/app/panel-layout.ts`
  - `src/app/event-handlers.ts`
  - `src/components/UnifiedSettings.ts`
  - `src/settings-window.ts`
  - `src/services/source-cap.ts`
  - `src/locales/*.json`
  - `tests/panel-variant-config.test.mts`
- Remaining gates:
  - Free users are still limited to 40 panels and 80 sources.
  - The limits are enforced during boot, settings changes, command-search adds, source toggles, and dashboard-tab save / restore.
  - Many translated locales still explicitly say `Upgrade to PRO for unlimited`.
- Task:
  - Remove `FREE_MAX_PANELS`, `FREE_MAX_SOURCES`, cap enforcement, cap recovery migrations, upgrade toasts, and tier-specific tests.
  - Preserve only universal performance safeguards that apply equally to every plan.
- Acceptance:
  - Free users can enable every available panel and source, and no layout or settings path silently disables items because of plan tier.

### [ ] D5. Remove the paid followed-country cap and checkout path

- Files:
  - `src/App.ts`
  - `src/utils/follow-button.ts`
  - `src/services/followed-countries.ts`
  - `convex/constants.ts`
  - `convex/followedCountries.ts`
  - `scripts/seed-digest-notifications.mjs`
  - related followed-country tests
- Current UI:
  - `Upgrade to follow more`
  - `Follow limit reached`
  - `Upgrade`
- Remaining gate:
  - Free users can follow only three countries; the client opens checkout on `FREE_CAP`, Convex enforces the cap, and the brief composer clamps free-user personalization to three countries.
- Task:
  - Remove the client, Convex, merge, downgrade, and digest-composer tier caps.
  - Remove the cap-drop event and checkout trigger.
  - Retain a single universal abuse / storage bound only if operationally required.
- Acceptance:
  - Free users can follow the same supported number of countries as paid users and never see an upgrade action from the follow control.

### [ ] D6. Make Latest Brief composition actually available to free accounts

- Files:
  - `src/components/LatestBriefPanel.ts`
  - `api/latest-brief.ts`
  - `scripts/seed-digest-notifications.mjs`
  - `convex/alertRules.ts`
  - `docs/panels/latest-brief.mdx`
  - brief preview / composer tests
- Remaining gap:
  - The read endpoint accepts any signed-in user, but it only reads envelopes produced by the paid notification-rule composer.
  - Free users cannot normally create those rules, so the public panel can remain in `composing` forever without a `brief:latest:<userId>` pointer.
- Task:
  - Compose a dashboard brief for signed-in free users independently of paid delivery rules, or provide a shared public brief that the panel can render.
  - Keep scheduled email / Slack / Discord / Telegram delivery paid if desired; only decouple dashboard content production from that delivery entitlement.
  - Remove stale premium-denial handling from the panel once the endpoint contract is public.
- Acceptance:
  - A newly created tier-0 account reaches a real `ready` brief without ever owning a paid alert or digest rule.

### [ ] D7. Remove now-public panels from the Pro entitlement lifecycle

- Files:
  - `src/App.ts`
  - `src/app/data-loader.ts`
  - `src/services/global-tenders.ts`
  - `tests/premium-loaders-fan-out-coverage.test.mts`
- Remaining gate:
  - The entitlement transition fan-out still treats Trade Policy, Stock Analysis, Backtesting, Daily Market Brief, Resilience, and Global Procurement as Pro loaders.
  - A Pro-to-free transition explicitly clears Global Procurement data even though its panel and RPC are public.
- Task:
  - Replace the Pro transition fan-out with normal panel lifecycle / refresh scheduling.
  - Never clear public panel data on sign-out, expiry, or subscription downgrade.
- Acceptance:
  - Changing auth or billing state cannot make a now-public panel disappear, empty its cache, or wait for an entitlement transition before loading.

### [ ] D8. Remove residual tier-1 gates from country intelligence and sanctions data

- Files:
  - `src/shared/premium-paths.ts`
  - `server/_shared/entitlement-check.ts`
  - `src/app/country-intel.ts`
  - `src/services/sanctions-pressure.ts`
  - `server/worldmonitor/intelligence/v1/get-country-intel-brief.ts`
  - `server/worldmonitor/sanctions/v1/list-sanctions-pressure.ts`
  - `server/worldmonitor/supply-chain/v1/get-country-cost-shock.ts`
  - `tests/premium-stock-gateway.test.mts`
  - `tests/supply-chain-sprint2.test.mjs`
- Remaining gates:
  - Country Intel Brief, Sanctions Pressure, and Country Cost Shock remain in the premium path / tier-1 allowlists.
  - Sanctions Pressure deliberately returns no RPC data to free users.
  - Country Cost Shock returns an empty result for free callers.
  - Country Intel Brief contains a shared non-premium composition path, but the gateway tier check prevents signed-in free users from reaching it.
- Task:
  - Remove paid-tier requirements for dashboard-supporting reads and align handler-level checks with the public contract.
  - Keep direct-LLM cost controls as per-account free quotas rather than Pro checks.
  - Rename `fetchProSections()` and remove dead `makeProLocked()` / premium-only comments after the data paths are public.
- Acceptance:
  - A free user receives real country brief, sanctions, and cost-shock data; the Sanctions Pressure panel no longer resolves to an entitlement-caused empty state.

### [ ] D9. Finish desktop and map-layer ungating

- Files:
  - `src/app/panel-layout.ts`
  - `src/app/data-loader.ts`
  - `src/components/DeckGLMap.ts`
  - map-layer and desktop tests
- Remaining gates:
  - Desktop Forecast, Israel Sirens, and Telegram Intel panels are still rendered through `showLocked()` for non-premium users.
  - Desktop Telegram and OREF loaders are skipped for non-premium users.
  - Resilience ranking is cleared / skipped unless `hasPremiumAccess()` is true.
  - Trade-route status colors are reduced for free users while paid users receive actual disrupted / high-risk styling.
- Task:
  - Remove `_lockPanels`, `_desktopLocked`, resilience entitlement guards, and tier-dependent route styling.
  - Preserve renderer / platform capability checks such as DeckGL-only behavior; remove only plan checks.
- Acceptance:
  - Free desktop and web users receive the same Forecast, OREF, Telegram, Resilience, and trade-route visualization behavior when their runtime supports it.

### [ ] D10. Ungate global export and playback

- Files:
  - `src/app/event-handlers.ts`
  - `src/services/analytics.ts`
  - export / playback tests
- Remaining gates:
  - The global Export control is mounted only for Clerk users with `role === 'pro'`.
  - Playback is hidden for every non-Pro user.
  - These are the two remaining `trackGateHit(...)` callers.
- Task:
  - Mount both controls for every supported user state.
  - Remove their auth subscriptions, `trackGateHit('export')`, `trackGateHit('playback')`, and the telemetry helper if it becomes unused.
- Acceptance:
  - Anonymous and signed-in free users can export current dashboard data and use playback without changing plans.

### [ ] D11. Ungate live flight search

- Files:
  - `src/app/search-manager.ts`
  - `src/locales/*.json`
  - command-search tests
- Remaining gates:
  - Callsign search and the live flight search source return early unless `isProUser()` is true.
  - English and translated search copy still labels live flight search as `(PRO)`.
- Task:
  - Register, populate, and execute the live flight search source for all users.
  - Remove the plan label from every locale.
- Acceptance:
  - Free users can search live flights by callsign and receive the same result interactions as paid users.

### [ ] D12. Ungate analytical framework selection

- Files:
  - `src/services/analysis-framework-store.ts`
  - `src/components/FrameworkSelector.ts`
  - `src/components/InsightsPanel.ts`
  - `src/components/DeductionPanel.ts`
  - framework-selector tests
- Remaining gate:
  - Framework selection is public only for Daily Market Brief; Insights and Deduct Situation still pass premium state into `FrameworkSelector`, whose locked branch renders the shared upgrade CTA.
- Task:
  - Make framework selection available on every public panel that implements it.
  - Remove the premium branch and shared-panel CTA dependency from `FrameworkSelector`.
- Acceptance:
  - A free user can select and apply every shipped analytical framework in Daily Market Brief, Insights, Deduction, and Market Implications.

### [ ] D13. Remove the remaining shared panel gate machinery and upsell locales

- Files:
  - `src/components/Panel.ts`
  - `src/services/panel-gating.ts`
  - `src/app/panel-layout.ts`
  - `src/config/panels.ts`
  - `src/components/LatestBriefPanel.ts`
  - `src/locales/en.shell.json`
  - `src/locales/en.json`
  - `src/locales/*.json`
  - `src/styles/main.css`
- Remaining copy / code:
  - `Panel.showLocked()`, `Panel.showGatedCta()`, `WEB_PREMIUM_PANELS`, `getProPanelKeys()`, and locked-panel CSS still exist.
  - The full English locale still contains the removed Pro banner.
  - Most non-English locales retain literal `Sign In to Unlock`, `Upgrade to Pro`, premium analytics, panel-cap, and source-cap copy.
- Task:
  - After D1-D12, remove the generic dashboard panel-gating API, stale lock styles, dead banner locale keys, premium feature descriptions, and translated upsell strings.
  - Keep billing-state recovery UI only where it manages an actual paid capability; do not route it through public panel chrome.
- Acceptance:
  - No base panel can render a plan badge, plan lock, or upgrade CTA, and locale fallback cannot reintroduce one in another language.

### [ ] D14. Replace tests that still enforce the old premium dashboard contract

- Files:
  - `e2e/auth-ui.spec.ts`
  - `tests/panel-config-guardrails.test.mjs`
  - `tests/panel-variant-config.test.mts`
  - `tests/mobile-panel-nav-categories.test.mts`
  - `tests/premium-loaders-fan-out-coverage.test.mts`
  - `tests/agent-bus-applier.test.mts`
  - `tests/a11y-axe-regression.test.mts`
  - `tests/stock-analysis-targets.test.mts`
  - relevant gateway / sanctions / supply-chain / followed-country tests
- Remaining gap:
  - The suite still requires locked anonymous panels, premium panel sets, Pro loader fan-out, free caps, and tier-1 denial responses.
- Task:
  - Delete obsolete gate assertions and add anonymous plus signed-in tier-0 acceptance coverage for every formerly gated feature.
  - Include data-bearing assertions, not only absence of `PRO` text.
- Acceptance:
  - Tests fail if a public feature regains a client lock, server 403, empty entitlement fallback, reduced tier-specific dataset, or upgrade copy.

### [ ] D15. Correct Pro marketing source and rebuild static output

- Files:
  - `pro-test/src/locales/*.json`
  - `pro-test/index.html`
  - `pro-test/welcome.html`
  - other `pro-test/src` pricing / welcome components
  - `blog-site/src/content/blog/*.md`
  - `server/worldmonitor/leads/v1/register-interest.ts`
  - generated `public/pro/index.html`
  - generated `public/pro/welcome.html`
- Stale claims:
  - Pro pricing and metadata still sell WM Analyst, Stock Analysis, Backtesting, Scenario Engine, Route Explorer, AI Market Implications, Regional Intelligence, map layers, and market watchlists as paid features.
  - Source and generated HTML have drifted: some generated SEO text was edited, while the source and rendered root still contain old claims.
- Task:
  - Rewrite all languages, structured metadata, blog product claims, and lifecycle emails so paid plans list only capabilities that remain intentionally paid.
  - Rebuild `public/pro` from `pro-test`; do not hand-edit `public/pro/assets/`.
- Acceptance:
  - Pricing, welcome, SEO, JSON-LD, `noscript`, and hydrated content never advertise a public dashboard feature as Pro-only.

### [ ] D16. Update documentation and generated API descriptions

- Files:
  - `docs/features.mdx`
  - `docs/pricing.mdx`
  - `docs/authentication.mdx`
  - `docs/DEPLOYMENT-PLAN.md`
  - `docs/premium-finance.mdx`
  - `docs/panels/*.mdx`
  - `docs/methodology/*.mdx`
  - `proto/worldmonitor/market/v1/*.proto`
  - `proto/worldmonitor/supply_chain/v1/*.proto`
  - `server/gateway.ts`
  - `server/worldmonitor/intelligence/v1/get-regional-snapshot.ts`
  - generated `src/generated/**`
  - generated `docs/api/**`
- Stale claims:
  - Panel docs still mark Daily Market Brief, Chat Analyst, Deduction, Supply Chain enhancements, Sanctions Pressure, Stock Analysis, Backtesting, and other unlocked surfaces as Pro.
  - Proto comments and generated OpenAPI descriptions still call several now-public market, procurement, regional, route, and supply-chain operations premium-gated.
  - Gateway / handler comments incorrectly say regional RPCs are premium-gated.
- Task:
  - Fix source docs and proto comments, then run `make generate` so generated clients and OpenAPI stay authoritative.
  - Preserve paid wording only for intentional API/MCP, notification-delivery, widget-builder, and partner-webhook capabilities.
- Acceptance:
  - Product docs, API docs, and runtime behavior agree on which capabilities are public.

### [ ] D17. Perform a source-aware final `Pro` / `Premium` allowlist sweep

- Commands:

```bash
rg -n --hidden -S '\bPro\b|\bPRO\b|premium|Upgrade to Pro|Upgrade to PRO|Sign In to Unlock' \
  src public blog-site pro-test docs proto server api convex scripts tests \
  --glob '!public/pro/assets/**' \
  --glob '!src/generated/**' \
  --glob '!docs/api/**'
```

- Task:
  - Classify every remaining match as intentional product-plan naming, an economic term such as insurance / price premium, a proper noun such as Premium Times / Premium Economy, or stale dashboard gating.
  - Remove stale helpers, comments, telemetry, locale keys, docs, and test names rather than suppressing them.
  - Record a small explicit allowlist for the intentional paid capabilities so future audits can detect new dashboard upsells.
- Acceptance:
  - No public product surface or supporting contract contains a stale upgrade prompt, premium lock, tier-reduced dashboard result, or claim that a public feature requires Pro.

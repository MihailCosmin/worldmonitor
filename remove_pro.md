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

### [ ] R5. Remove the notifications-tab upsell card and replace with neutral onboarding

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

### [ ] R6. Remove `Pro` category chips and badge-only labels after unlock work is done

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

### [ ] F1. Ungate stock analysis

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

### [ ] F2. Ungate stock backtesting

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

### [ ] F3. Ungate Daily Market Brief

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

### [ ] F4. Ungate WM Analyst chat

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

### [ ] F5. Ungate Global Procurement

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

### [ ] F6. Ungate Trade Policy

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

### [ ] F7. Ungate Latest Brief

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

### [ ] F8. Ungate WSB Ticker Scanner

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

### [ ] F9. Ungate AI Market Implications

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

### [ ] F10. Ungate Regional Intelligence

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

### [ ] F11. Ungate Route Explorer

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

### [ ] F12. Ungate Scenario Engine

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

### [ ] F13. Ungate bypass corridors in supply-chain and country detail views

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

### [ ] F14. Ungate country deep-dive premium cards

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

### [ ] F15. Ungate evidence export

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

### [ ] F16. Ungate chokepoint popup widgets

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

### [ ] F17. Ungate resilience scores

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

### [ ] F18. Ungate premium/enhanced map layers

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

### [ ] S1. Remove `PRO` badges from panel settings once panel locks are gone

- Files:
  - `src/components/UnifiedSettings.ts`
- Source refs:
  - `src/components/UnifiedSettings.ts:921`
- Task:
  - Remove `PRO` badges from panel toggles after each gated panel is made available.

### [ ] S2. Rework `API Keys` and `MCP Clients` tab labeling

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

### [ ] S3. Remove the generic settings upgrade cards

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

### [ ] C1. Remove stale `Pro` / `Premium` names from panels and copy

- Examples to rename:
  - `Premium Stock Analysis`
  - `Premium Backtesting`
- Files:
  - `src/components/StockAnalysisPanel.ts`
  - `src/components/StockBacktestPanel.ts`
  - any matching locale/config entries

### [ ] C2. Remove stale premium analytics telemetry and gate tracking where no longer useful

- Files:
  - any remaining `trackGateHit(...)` callers on now-public features
- Task:
  - remove gate-hit instrumentation that no longer represents a real gate

### [ ] C3. Sweep remaining strings

- Command to rerun after implementation:

```bash
rg -n --hidden -S '\\bPro\\b|\\bPRO\\b|premium|Upgrade to Pro|Upgrade to PRO|Sign In to Unlock' src public blog-site
```

- Acceptance:
  - only intentional, non-upsell references remain
  - no user-facing `Upgrade to Pro` / `Premium` lock text survives on public product surfaces

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Regression guard for removing stale Pro lifecycle handling from now-public
// loaders. Once a panel is public, auth/billing transitions must not be the
// thing that primes it, clears it, or swaps its transport.

const REPO_ROOT = resolve(import.meta.dirname, '..');
const APP_TS = readFileSync(resolve(REPO_ROOT, 'src/App.ts'), 'utf8');
const PANEL_LAYOUT_TS = readFileSync(resolve(REPO_ROOT, 'src/app/panel-layout.ts'), 'utf8');
const DATA_LOADER_TS = readFileSync(resolve(REPO_ROOT, 'src/app/data-loader.ts'), 'utf8');
const DECKGL_MAP_TS = readFileSync(resolve(REPO_ROOT, 'src/components/DeckGLMap.ts'), 'utf8');
const GLOBAL_TENDERS_TS = readFileSync(resolve(REPO_ROOT, 'src/services/global-tenders.ts'), 'utf8');

describe('now-public loaders stay on the normal panel lifecycle', () => {
  it('removes the entitlement transition fan-out and downgrade clear path', () => {
    assert.doesNotMatch(
      APP_TS,
      /const\s+firePremiumLoaders\s*=/,
      'public loaders must not wait for an entitlement-transition fan-out helper',
    );
    assert.doesNotMatch(
      APP_TS,
      /unsubEntitlementPremiumLoaders/,
      'App.ts should no longer wire a public-loader entitlement subscription',
    );
    assert.doesNotMatch(
      APP_TS,
      /void\s+this\.dataLoader\.clearGlobalTenders\(\)/,
      'Global Procurement must not be cleared on sign-out, expiry, or downgrade',
    );
  });

  it('keeps public loaders on the regular prime and refresh paths', () => {
    for (const [panelId, loader] of [
      ['global-procurement', 'loadGlobalTenders'],
      ['trade-policy', 'loadTradePolicy'],
      ['stock-analysis', 'loadStockAnalysis'],
      ['stock-backtest', 'loadStockBacktest'],
      ['daily-market-brief', 'loadDailyMarketBrief'],
    ] as const) {
      assert.match(
        APP_TS,
        new RegExp(`shouldPrime\\('${panelId}'\\)[\\s\\S]*?this\\.dataLoader\\.${loader}\\(`),
        `${panelId} must stay on the normal prime path`,
      );
    }
    assert.match(
      APP_TS,
      /scheduleRefresh\('tradePolicy', \(\) => this\.dataLoader\.loadTradePolicy\(\)/,
      'Trade Policy must stay on the refresh scheduler rather than entitlement fan-out',
    );
    assert.match(
      APP_TS,
      /scheduleRefresh\(\s*'stock-analysis'[\s\S]*?loadStockAnalysis\(\)[\s\S]*?'daily-market-brief'[\s\S]*?loadDailyMarketBrief\(\)[\s\S]*?'stock-backtest'[\s\S]*?loadStockBacktest\(\)/,
      'finance public loaders must stay on the refresh scheduler rather than entitlement fan-out',
    );
    assert.match(
      APP_TS,
      /\{\s*name: 'global-tenders', fn: \(\) => this\.dataLoader\.loadGlobalTenders\(\)/,
      'Global Procurement must stay on the normal refresh scheduler',
    );
  });

  it('keeps Daily Market Brief on the public load path', () => {
    assert.doesNotMatch(
      DATA_LOADER_TS,
      /if\s*\(\s*hasPremiumAccess\(\)\s*\)\s*\{\s*await\s+this\.loadDailyMarketBrief\(true\);\s*\}/s,
      'watchlist-triggered Daily Market Brief refresh must not be wrapped in hasPremiumAccess()',
    );
    assert.doesNotMatch(
      DATA_LOADER_TS,
      /async\s+loadDailyMarketBrief\([^)]*\):\s*Promise<void>\s*\{\s*if\s*\(!hasPremiumAccess\(\)\)\s*return;/s,
      'loadDailyMarketBrief() must not early-return for non-premium users',
    );
    assert.doesNotMatch(
      APP_TS,
      /if\s*\(\s*hasPremiumAccess\(\)\s*&&\s*shouldPrime\('daily-market-brief'\)\s*\)/,
      'fast-prime must not gate Daily Market Brief behind hasPremiumAccess()',
    );
    assert.doesNotMatch(
      APP_TS,
      /void\s+this\.dataLoader\.loadDailyMarketBrief\(\)/,
      'Daily Market Brief should no longer be treated as an entitlement-transition fan-out loader',
    );
  });

  it('keeps Resilience on the public layer lifecycle', () => {
    assert.match(
      DATA_LOADER_TS,
      /if \(this\.ctx\.mapLayers\.resilienceScore\) \{\s*tasks\.push\(\{ name: 'resilienceRanking', task: \(\) => runGuarded\('resilienceRanking', \(\) => this\.loadResilienceRanking\(\)\) \}\);\s*\}/s,
      'resilience loads should run whenever the layer is enabled, not only for Pro users',
    );
    assert.doesNotMatch(
      DATA_LOADER_TS,
      /if \(hasPremiumAccess\(\)\) \{\s*tasks\.push\(\{ name: 'resilienceRanking'/s,
      'resilience layer load must not be wrapped in hasPremiumAccess()',
    );
    assert.doesNotMatch(
      DATA_LOADER_TS,
      /async loadResilienceRanking\([^)]*\): Promise<void> \{\s*if \(!hasPremiumAccess\(\)/s,
      'loadResilienceRanking() must not early-return for non-premium users',
    );
  });

  it('does not desktop-lock public forecast and intelligence panels', () => {
    assert.doesNotMatch(
      PANEL_LAYOUT_TS,
      /const\s+_lockPanels\s*=\s*this\.ctx\.isDesktopApp\s*&&\s*!hasPremiumAccess\(\);/,
      'desktop panel mounts must not reintroduce the _lockPanels premium gate',
    );
    for (const panelId of ['forecast', 'oref-sirens', 'telegram-intel'] as const) {
      assert.doesNotMatch(
        PANEL_LAYOUT_TS,
        new RegExp(`lazyDefaultPanel\\(\\s*'${panelId}'[\\s\\S]*?_lockPanels\\s*\\?`, 's'),
        `${panelId} must mount without a desktop-only lockedFeatures premium gate`,
      );
    }
  });

  it('keeps desktop Telegram and OREF on the normal intelligence load path', () => {
    assert.doesNotMatch(
      DATA_LOADER_TS,
      /const\s+_desktopLocked\s*=\s*isDesktopRuntime\(\)\s*&&\s*!hasPremiumAccess\(\);/,
      'desktop intelligence loads must not define a premium-only _desktopLocked gate',
    );
    assert.match(
      DATA_LOADER_TS,
      /tasks\.push\(this\.loadTelegramIntel\(\)\);/,
      'Telegram Intel should stay on the regular intelligence task list',
    );
    assert.match(
      DATA_LOADER_TS,
      /tasks\.push\(\(async \(\) => \{\s*try \{\s*const data = await fetchOrefAlerts\(\)/s,
      'OREF should stay on the regular intelligence task list',
    );
    assert.doesNotMatch(
      DATA_LOADER_TS,
      /async\s+loadTelegramIntel\([^)]*\):\s*Promise<void>\s*\{\s*if\s*\(\s*isDesktopRuntime\(\)\s*&&\s*!hasPremiumAccess\(\)\s*\)\s*return;/s,
      'loadTelegramIntel() must not early-return for non-premium desktop users',
    );
  });

  it('uses live trade-route status colors for every plan tier', () => {
    assert.doesNotMatch(
      DECKGL_MAP_TS,
      /private createTradeRoutesLayer\(\): ArcLayer<TradeRouteSegment> \{[\s\S]*hasPremiumAccess\(getAuthState\(\)\)/,
      'trade-route layer colors must not branch on premium access',
    );
    assert.doesNotMatch(
      DECKGL_MAP_TS,
      /private buildTradeTrips\(\): void \{[\s\S]*hasPremiumAccess\(getAuthState\(\)\)/,
      'animated trade-route trips must not branch on premium access',
    );
  });

  it('uses a public transport for Global Procurement', () => {
    assert.doesNotMatch(
      GLOBAL_TENDERS_TS,
      /premiumFetch/,
      'Global Procurement is public and must not depend on premiumFetch',
    );
    assert.match(
      GLOBAL_TENDERS_TS,
      /new EconomicServiceClient\(getRpcBaseUrl\(\), \{\s*fetch: \(\.\.\.args: Parameters<typeof fetch>\) => globalThis\.fetch\(\.\.\.args\),\s*\}\)/s,
      'Global Procurement should use the normal fetch transport',
    );
  });
});

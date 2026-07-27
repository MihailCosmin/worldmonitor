import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const STORE_TS = readFileSync(resolve(REPO_ROOT, 'src/services/analysis-framework-store.ts'), 'utf8');
const SELECTOR_TS = readFileSync(resolve(REPO_ROOT, 'src/components/FrameworkSelector.ts'), 'utf8');
const DAILY_TS = readFileSync(resolve(REPO_ROOT, 'src/components/DailyMarketBriefPanel.ts'), 'utf8');
const INSIGHTS_TS = readFileSync(resolve(REPO_ROOT, 'src/components/InsightsPanel.ts'), 'utf8');
const DEDUCTION_TS = readFileSync(resolve(REPO_ROOT, 'src/components/DeductionPanel.ts'), 'utf8');
const MARKET_IMPLICATIONS_TS = readFileSync(resolve(REPO_ROOT, 'src/components/MarketImplicationsPanel.ts'), 'utf8');

describe('analytical framework selection stays public', () => {
  it('analysis framework store no longer gates framework reads by premium access', () => {
    assert.doesNotMatch(
      STORE_TS,
      /hasPremiumAccess/,
      'analysis-framework-store.ts must not depend on premium access for framework selection',
    );
    assert.doesNotMatch(
      STORE_TS,
      /isFrameworkSelectionEnabledForPanel/,
      'analysis-framework-store.ts should not keep a stale per-panel framework entitlement helper',
    );
    assert.match(
      STORE_TS,
      /export function getActiveFrameworkForPanel\(panelId: AnalysisPanelId\): AnalysisFramework \| null \{/,
      'getActiveFrameworkForPanel() must remain the shared public lookup',
    );
    assert.doesNotMatch(
      STORE_TS,
      /getActiveFrameworkForPanel\([^)]*\): AnalysisFramework \| null \{\s*if \(!.*\) return null;/s,
      'getActiveFrameworkForPanel() must not early-return on a plan gate',
    );
  });

  it('FrameworkSelector no longer renders a premium lock branch or panel CTA', () => {
    assert.doesNotMatch(
      SELECTOR_TS,
      /PanelGateReason|showGatedCta|framework-settings-btn--locked/,
      'FrameworkSelector should not depend on shared locked-panel CTA plumbing',
    );
    assert.doesNotMatch(
      SELECTOR_TS,
      /isPremium:\s*boolean|panel:\s*Panel \| null/,
      'FrameworkSelector options should no longer accept premium state or a gated panel dependency',
    );
    assert.match(
      SELECTOR_TS,
      /select\.addEventListener\('change', \(\) => \{\s*setActiveFrameworkForPanel\(opts\.panelId, select\.value \|\| null\);/s,
      'FrameworkSelector should always allow changing the active framework',
    );
  });

  it('all public framework panels instantiate the selector without plan-gate props', () => {
    for (const [label, source, panelId] of [
      ['Daily Market Brief', DAILY_TS, 'daily-market-brief'],
      ['Insights', INSIGHTS_TS, 'insights'],
      ['Deduction', DEDUCTION_TS, 'deduction'],
      ['Market Implications', MARKET_IMPLICATIONS_TS, 'market-implications'],
    ] as const) {
      assert.match(
        source,
        new RegExp(`new FrameworkSelector\\(\\{[\\s\\S]*panelId:\\s*'${panelId}'`, 's'),
        `${label} must still instantiate FrameworkSelector`,
      );
      assert.doesNotMatch(
        source,
        /new FrameworkSelector\(\{[\s\S]*isPremium:/s,
        `${label} must not pass a premium gate prop into FrameworkSelector`,
      );
      assert.doesNotMatch(
        source,
        /new FrameworkSelector\(\{[\s\S]*panel:\s*this/s,
        `${label} must not pass a locked-panel dependency into FrameworkSelector`,
      );
    }
  });
});

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LOCALES_DIR = resolve(ROOT, 'src/locales');

function read(path) {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

function readLocaleFile(name) {
  return readFileSync(resolve(LOCALES_DIR, name), 'utf8');
}

function readLocaleJson(name) {
  return JSON.parse(readLocaleFile(name));
}

describe('D13 shared panel cleanup', () => {
  it('removes the shared dashboard panel gate machinery', () => {
    assert.doesNotMatch(
      read('src/components/Panel.ts'),
      /\bshowLocked\s*\(|\bshowGatedCta\s*\(|\bunlockPanel\s*\(|panel-locked-|panel-is-locked|panel-pro-badge/,
    );
    assert.doesNotMatch(
      read('src/app/panel-layout.ts'),
      /\bWEB_PREMIUM_PANELS\b|\bupdatePanelGating\b|\bgetGateAction\b|showLocked\s*\(/,
    );
    assert.doesNotMatch(
      read('src/config/panels.ts'),
      /\bgetProPanelKeys\b/,
    );
    assert.doesNotMatch(
      read('src/services/panel-gating.ts'),
      /\bPanelGateReason\b|\bgetPanelGateReason\b|\bresolveBillingAwareGateReason\b/,
    );
  });

  it('moves settings-only access cards onto dedicated styling hooks', () => {
    const settings = read('src/components/UnifiedSettings.ts');
    assert.match(settings, /settings-access-state/);
    assert.doesNotMatch(settings, /panel-locked-state|panel-locked-icon|panel-locked-desc|panel-locked-cta/);

    const css = read('src/styles/main.css');
    assert.match(css, /\.settings-access-state/);
    assert.doesNotMatch(css, /\.panel-locked-|\.panel-pro-badge|panel-is-locked|framework-settings-btn--locked/);
  });
});

describe('D13 locale cleanup', () => {
  const localeFiles = readdirSync(LOCALES_DIR).filter((name) => name.endsWith('.json')).sort();

  it('removes the pro banner and premium upsell branches from every locale bundle', () => {
    for (const name of localeFiles) {
      const locale = readLocaleJson(name);
      assert.equal(locale.premium, undefined, `${name} should not define a top-level premium locale branch`);
      assert.equal(locale.components?.proBanner, undefined, `${name} should not define components.proBanner`);
    }
  });

  it('does not leave the old English upsell strings behind in locale files', () => {
    const staleEnglishUpsell = /Pro is launched|Upgrade to Pro|Upgrade to PRO|Sign In to Unlock|premium analytics/;
    for (const name of localeFiles) {
      assert.doesNotMatch(readLocaleFile(name), staleEnglishUpsell, `${name} still contains stale upsell copy`);
    }
  });
});

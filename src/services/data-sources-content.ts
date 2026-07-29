/**
 * "Data Sources" settings tab — self-hosted web only (see showDataSourcesTab
 * in UnifiedSettings.ts). Lets a signed-in self-hosted user view/edit the
 * same env-configured secrets (GROQ_API_KEY, FINNHUB_API_KEY, etc.) that
 * desktop manages through its own runtime-config panel, without needing a
 * separate panel-grid entry — always reachable via Settings instead.
 *
 * Reuses runtime-config.ts as the data/write layer; this file only owns
 * rendering + DOM wiring, mirroring the {html, attach} contract used by
 * preferences-content.ts and notifications-settings.ts.
 */
import {
  RUNTIME_FEATURES,
  canEditRuntimeConfig,
  getEffectiveSecrets,
  getRuntimeConfigSnapshot,
  getSecretState,
  isFeatureAvailable,
  isFeatureEnabled,
  setFeatureToggle,
  setSecretValue,
  subscribeRuntimeConfig,
  validateSecret,
  type RuntimeFeatureDefinition,
  type RuntimeSecretKey,
} from '@/services/runtime-config';
import { subscribeAuthState, signIn } from '@/services/auth-state';
import { SIGNUP_URLS, PLAINTEXT_KEYS, MASKED_SENTINEL } from '@/services/settings-constants';
import { escapeHtml } from '@/utils/sanitize';
import { setTrustedHtml, trustedHtml } from '@/utils/dom-utils';
import { t } from '@/services/i18n';

export interface DataSourcesResult {
  html: string;
  attach: (container: HTMLElement) => () => void;
}

function renderSecretRow(key: RuntimeSecretKey, canEdit: boolean): string {
  const state = getSecretState(key);
  const signupUrl = SIGNUP_URLS[key];
  const helpKey = `modals.runtimeConfig.help.${key}`;
  const helpRaw = t(helpKey);
  const helpText = helpRaw !== helpKey ? helpRaw : '';
  const showGetKey = signupUrl && !state.present;
  const isPlaintext = PLAINTEXT_KEYS.has(key);
  const statusKey = !state.present ? 'missing' : state.valid ? 'valid' : 'looksInvalid';
  const statusClass = state.valid ? 'ok' : 'warn';

  return `
    <div class="data-source-secret-row">
      <div class="data-source-secret-key"><code>${escapeHtml(key)}</code></div>
      <span class="data-source-secret-status ${statusClass}">${escapeHtml(t(`modals.runtimeConfig.status.${statusKey}`))}</span>
      ${helpText ? `<div class="data-source-secret-meta">${escapeHtml(helpText)}</div>` : ''}
      <div class="data-source-input-wrapper${showGetKey ? ' has-suffix' : ''}">
        <input
          type="${isPlaintext ? 'text' : 'password'}"
          data-secret="${key}"
          placeholder="${t('modals.runtimeConfig.placeholder.setSecret')}"
          autocomplete="off"
          ${canEdit ? '' : 'disabled'}
          value="${isPlaintext && state.present ? escapeHtml(getRuntimeConfigSnapshot().secrets[key]?.value ?? '') : ''}"
        >
        ${showGetKey ? `<a href="${escapeHtml(signupUrl)}" target="_blank" rel="noopener noreferrer" class="data-source-secret-link">Get key</a>` : ''}
      </div>
      <span class="data-source-secret-hint" data-hint hidden></span>
    </div>
  `;
}

function renderFeature(feature: RuntimeFeatureDefinition, canEdit: boolean): string {
  const enabled = isFeatureEnabled(feature.id);
  const available = isFeatureAvailable(feature.id);
  const secrets = getEffectiveSecrets(feature);
  const pillClass = available ? 'ok' : 'warn';
  const pillLabel = available ? t('modals.runtimeConfig.status.ready') : t('modals.runtimeConfig.status.needsKeys');

  return `
    <section class="data-source-feature ${available ? 'available' : 'degraded'}">
      <header class="data-source-feature-header">
        <label>
          <input type="checkbox" data-toggle="${feature.id}" ${enabled ? 'checked' : ''} ${canEdit ? '' : 'disabled'}>
          <span>${escapeHtml(feature.name)}</span>
        </label>
        <span class="data-source-pill ${pillClass}">${pillLabel}</span>
      </header>
      ${secrets.length > 0 ? `<div class="data-source-secrets">${secrets.map((key) => renderSecretRow(key, canEdit)).join('')}</div>` : ''}
      ${!available ? `<p class="data-source-fallback">${escapeHtml(feature.fallback)}</p>` : ''}
    </section>
  `;
}

export function renderDataSourcesContent(): DataSourcesResult {
  const canEdit = canEditRuntimeConfig();
  const availableCount = RUNTIME_FEATURES.filter((f) => isFeatureAvailable(f.id)).length;

  const html = `
    <div class="data-sources-summary">
      ${availableCount}/${RUNTIME_FEATURES.length} ${t('modals.runtimeConfig.summary.available')}
    </div>
    ${canEdit ? '' : `
      <div class="data-sources-signin-cta">
        <button type="button" class="settings-access-cta" data-data-sources-signin>${escapeHtml(t('modals.runtimeConfig.signInToEdit'))}</button>
      </div>
    `}
    <div class="data-sources-list" data-data-sources-list>
      ${RUNTIME_FEATURES.map((feature) => renderFeature(feature, canEdit)).join('')}
    </div>
  `;

  return {
    html,
    attach(container: HTMLElement): () => void {
      const ac = new AbortController();
      const { signal } = ac;

      function rerenderList(): void {
        const list = container.querySelector<HTMLElement>('[data-data-sources-list]');
        if (!list) return;
        const stillEditable = canEditRuntimeConfig();
        setTrustedHtml(list, trustedHtml(
          RUNTIME_FEATURES.map((feature) => renderFeature(feature, stillEditable)).join(''),
          'legacy direct innerHTML migration',
        ));
        attachListRowListeners();
      }

      function attachListRowListeners(): void {
        container.querySelectorAll<HTMLInputElement>('input[data-toggle]').forEach((input) => {
          input.addEventListener('change', () => {
            const featureId = input.dataset.toggle as RuntimeFeatureDefinition['id'] | undefined;
            if (!featureId) return;
            setFeatureToggle(featureId, input.checked);
          }, { signal });
        });

        container.querySelectorAll<HTMLInputElement>('input[data-secret]').forEach((input) => {
          input.addEventListener('blur', () => {
            const key = input.dataset.secret as RuntimeSecretKey | undefined;
            if (!key) return;
            const raw = input.value.trim();
            if (!raw || raw === MASKED_SENTINEL) return;

            const result = validateSecret(key, raw);
            const hint = input.closest('.data-source-secret-row')?.querySelector<HTMLElement>('[data-hint]');
            if (!result.valid) {
              if (hint) { hint.hidden = false; hint.textContent = result.hint || 'Invalid value'; }
              return;
            }
            if (hint) hint.hidden = true;

            void setSecretValue(key, raw).catch((err: unknown) => {
              if (hint) {
                hint.hidden = false;
                hint.textContent = err instanceof Error ? err.message : 'Failed to save';
              }
            });
          }, { signal });
        });
      }

      container.querySelector<HTMLButtonElement>('[data-data-sources-signin]')?.addEventListener('click', () => signIn(), { signal });

      attachListRowListeners();
      const unsubscribeConfig = subscribeRuntimeConfig(rerenderList);
      const unsubscribeAuth = subscribeAuthState(rerenderList);

      return () => {
        ac.abort();
        unsubscribeConfig();
        unsubscribeAuth();
      };
    },
  };
}

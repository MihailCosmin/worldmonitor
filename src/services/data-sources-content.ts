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
  secretsReady,
  setFeatureToggle,
  setSecretValue,
  validateSecret,
  verifySecretWithApi,
  type RuntimeFeatureDefinition,
  type RuntimeSecretKey,
} from '@/services/runtime-config';
import { subscribeAuthState, signIn } from '@/services/auth-state';
import { fetchOllamaModels } from '@/services/ollama-models';
import { SIGNUP_URLS, PLAINTEXT_KEYS, MASKED_SENTINEL } from '@/services/settings-constants';
import { escapeHtml } from '@/utils/sanitize';
import { setTrustedHtml, trustedHtml } from '@/utils/dom-utils';
import { t } from '@/services/i18n';

export interface DataSourcesResult {
  html: string;
  attach: (container: HTMLElement) => () => void;
}

/** Keys with a real, live connection check behind verifySecretWithApi (see
 * local-api-server.mjs's validateSecretAgainstProvider / the Vite dev-mode
 * equivalent) — these get a "Test Connection" button. Everything else only
 * gets format validation, so a test button would be misleading. */
const TESTABLE_KEYS = new Set<RuntimeSecretKey>(['OLLAMA_API_URL']);

/**
 * Model names last read back from the configured Ollama server (via a
 * successful Test Connection or a post-save background re-probe of
 * OLLAMA_API_URL — see attach()). Module-level rather than per-attach so the
 * dropdown survives closing/reopening the Settings modal within the same
 * page session; cleared whenever OLLAMA_API_URL changes so a stale list
 * from a previous endpoint is never shown as if it still applies. `null`
 * means "never fetched" (render OLLAMA_MODEL as free text); `[]` is treated
 * the same as `null` since an empty dropdown would be worse than a text
 * field the user can still type into.
 */
let ollamaModelCache: string[] | null = null;

/**
 * Self-hosted secret state is presence-only (see runtime-config.ts's
 * loadSelfHostedSecretStatus) — the server deliberately never echoes back
 * even plaintext values, so `currentValue` is blank on every render except
 * right after a same-session save. Auto-selecting models[0] whenever it's
 * blank would silently show (and, on Save, silently overwrite) a DIFFERENT
 * model than whatever the user actually has configured. So: only ever
 * pre-select a real option when currentValue is positively known; otherwise
 * show a disabled, unselectable placeholder that distinguishes "nothing set
 * yet" from "something's set but this UI can't read it back" — Save already
 * refuses an empty value (see saveSecretFromInput), so leaving the
 * placeholder selected is a safe no-op rather than a silent overwrite.
 */
function renderModelControl(canEdit: boolean, currentValue: string, isConfigured: boolean): string {
  const models = ollamaModelCache ?? [];
  const options = currentValue && !models.includes(currentValue) ? [currentValue, ...models] : models;
  const placeholderLabel = isConfigured
    ? t('modals.runtimeConfig.placeholder.modelConfiguredHidden')
    : t('modals.runtimeConfig.placeholder.selectModel');
  return `
    <select data-secret="OLLAMA_MODEL" ${canEdit ? '' : 'disabled'}>
      ${!currentValue ? `<option value="" disabled selected>${escapeHtml(placeholderLabel)}</option>` : ''}
      ${options.map((m) => `<option value="${escapeHtml(m)}"${m === currentValue ? ' selected' : ''}>${escapeHtml(m)}</option>`).join('')}
    </select>
  `;
}

/** Row content only (no outer wrapper div) — factored out so a single row
 * can be refreshed in place (e.g. upgrading OLLAMA_MODEL from text input to
 * dropdown once models are known) without touching sibling rows. */
function renderSecretRowInner(key: RuntimeSecretKey, canEdit: boolean): string {
  const state = getSecretState(key);
  const signupUrl = SIGNUP_URLS[key];
  const helpKey = `modals.runtimeConfig.help.${key}`;
  const helpRaw = t(helpKey);
  const helpText = helpRaw !== helpKey ? helpRaw : '';
  const showGetKey = signupUrl && !state.present;
  const isPlaintext = PLAINTEXT_KEYS.has(key);
  const currentValue = isPlaintext && state.present ? (getRuntimeConfigSnapshot().secrets[key]?.value ?? '') : '';
  const statusKey = !state.present ? 'missing' : state.valid ? 'valid' : 'looksInvalid';
  const statusClass = state.valid ? 'ok' : 'warn';

  const testable = TESTABLE_KEYS.has(key);
  const useModelDropdown = key === 'OLLAMA_MODEL' && ollamaModelCache !== null && ollamaModelCache.length > 0;

  return `
    <div class="data-source-secret-key"><code>${escapeHtml(key)}</code></div>
    <span class="data-source-secret-status ${statusClass}">${escapeHtml(t(`modals.runtimeConfig.status.${statusKey}`))}</span>
    ${helpText ? `<div class="data-source-secret-meta">${escapeHtml(helpText)}</div>` : ''}
    <div class="data-source-input-wrapper${showGetKey ? ' has-suffix' : ''}">
      ${useModelDropdown ? renderModelControl(canEdit, currentValue, state.present) : `
      <input
        type="${isPlaintext ? 'text' : 'password'}"
        data-secret="${key}"
        placeholder="${state.present ? t('modals.runtimeConfig.placeholder.configured') : t('modals.runtimeConfig.placeholder.setSecret')}"
        autocomplete="off"
        ${canEdit ? '' : 'disabled'}
        value="${escapeHtml(currentValue)}"
      >`}
      ${showGetKey ? `<a href="${escapeHtml(signupUrl)}" target="_blank" rel="noopener noreferrer" class="data-source-secret-link">Get key</a>` : ''}
      <button type="button" class="data-source-save-btn" data-save-secret="${key}" ${canEdit ? '' : 'disabled'}>Save</button>
      ${testable ? `<button type="button" class="data-source-test-btn" data-test-secret="${key}" ${canEdit ? '' : 'disabled'}>Test Connection</button>` : ''}
    </div>
    <span class="data-source-secret-hint" data-hint hidden></span>
  `;
}

function renderSecretRow(key: RuntimeSecretKey, canEdit: boolean): string {
  return `<div class="data-source-secret-row" data-secret-row="${key}">${renderSecretRowInner(key, canEdit)}</div>`;
}

function renderFeature(feature: RuntimeFeatureDefinition, canEdit: boolean): string {
  const enabled = isFeatureEnabled(feature.id);
  const available = isFeatureAvailable(feature.id);
  const secrets = getEffectiveSecrets(feature);
  const pillClass = available ? 'ok' : 'warn';
  const pillLabel = available ? t('modals.runtimeConfig.status.ready') : t('modals.runtimeConfig.status.needsKeys');

  return `
    <section class="data-source-feature ${available ? 'available' : 'degraded'}" data-feature="${feature.id}">
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

      function updateSummary(): void {
        const el = container.querySelector<HTMLElement>('.data-sources-summary');
        if (!el) return;
        const count = RUNTIME_FEATURES.filter((f) => isFeatureAvailable(f.id)).length;
        el.textContent = `${count}/${RUNTIME_FEATURES.length} ${t('modals.runtimeConfig.summary.available')}`;
      }

      /**
       * Targeted, in-place update for one feature's pill/fallback/secret-row
       * statuses — deliberately never touches any <input>'s value. This is
       * what lets a save in one field (or a feature-toggle flip) refresh
       * status text without wiping whatever the user is mid-typing into a
       * DIFFERENT field that hasn't been blurred/saved yet (#data-loss).
       */
      function updateFeatureStatus(feature: RuntimeFeatureDefinition): void {
        const section = container.querySelector<HTMLElement>(`[data-feature="${feature.id}"]`);
        if (!section) return;
        const available = isFeatureAvailable(feature.id);
        section.className = `data-source-feature ${available ? 'available' : 'degraded'}`;

        const pill = section.querySelector<HTMLElement>('.data-source-pill');
        if (pill) {
          pill.className = `data-source-pill ${available ? 'ok' : 'warn'}`;
          pill.textContent = available ? t('modals.runtimeConfig.status.ready') : t('modals.runtimeConfig.status.needsKeys');
        }

        const existingFallback = section.querySelector('.data-source-fallback');
        if (available) {
          existingFallback?.remove();
        } else if (!existingFallback) {
          const p = document.createElement('p');
          p.className = 'data-source-fallback';
          p.textContent = feature.fallback;
          section.appendChild(p);
        }

        for (const key of getEffectiveSecrets(feature)) {
          const row = section.querySelector<HTMLElement>(`[data-secret-row="${key}"]`);
          if (!row) continue;
          const state = getSecretState(key);
          const statusKey = !state.present ? 'missing' : state.valid ? 'valid' : 'looksInvalid';
          const statusEl = row.querySelector<HTMLElement>('.data-source-secret-status');
          if (statusEl) {
            statusEl.className = `data-source-secret-status ${state.valid ? 'ok' : 'warn'}`;
            statusEl.textContent = t(`modals.runtimeConfig.status.${statusKey}`);
          }
        }
      }

      function featuresUsingSecret(key: RuntimeSecretKey): RuntimeFeatureDefinition[] {
        return RUNTIME_FEATURES.filter((f) => getEffectiveSecrets(f).includes(key));
      }

      // Full-list rebuild — only for broad state shifts (sign-in/out
      // flipping every row's disabled state; the initial async hydration
      // of self-hosted secret presence). Preserves any in-progress typing
      // and focus across the rebuild so it's safe even if it happens to
      // fire while the user is mid-edit elsewhere.
      function rerenderList(): void {
        const list = container.querySelector<HTMLElement>('[data-data-sources-list]');
        if (!list) return;
        const active = document.activeElement;
        const activeKey = (active instanceof HTMLInputElement || active instanceof HTMLSelectElement)
          ? active.dataset.secret
          : undefined;
        const preserved = new Map<string, string>();
        container.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input[data-secret], select[data-secret]').forEach((el) => {
          if (el.dataset.secret && el.value) preserved.set(el.dataset.secret, el.value);
        });

        const stillEditable = canEditRuntimeConfig();
        setTrustedHtml(list, trustedHtml(
          RUNTIME_FEATURES.map((feature) => renderFeature(feature, stillEditable)).join(''),
          'legacy direct innerHTML migration',
        ));
        attachListRowListeners();
        updateSummary();

        for (const [key, value] of preserved) {
          const el = container.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-secret="${key}"]`);
          if (el) el.value = value;
        }
        if (activeKey) {
          container.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-secret="${activeKey}"]`)?.focus();
        }
      }

      /** Swaps just the OLLAMA_MODEL row's control (text input <-> select)
       * in place when ollamaModelCache changes, without touching any other
       * row — keeps this consistent with updateFeatureStatus's "never wipe
       * an unrelated field the user is mid-editing" rule. */
      function refreshModelRow(): void {
        const row = container.querySelector<HTMLElement>('[data-secret-row="OLLAMA_MODEL"]');
        if (!row) return;
        setTrustedHtml(row, trustedHtml(
          renderSecretRowInner('OLLAMA_MODEL', canEditRuntimeConfig()),
          'ollama model list changed — swap input/dropdown in place',
        ));
        attachSecretRowListeners(row);
      }

      /** Adopts a freshly discovered model list into the dropdown, if
       * non-empty. Shared by every OLLAMA_API_URL probe path (Test
       * Connection, post-save re-probe, on-open re-probe) so an empty/failed
       * result from one source never wipes a good list a sibling source
       * already found — see the two call sites this feeds for why there are
       * two sources at all (server-side probe vs. direct client fetch). */
      function adoptOllamaModels(models: string[] | undefined): void {
        if (!models || models.length === 0) return;
        ollamaModelCache = models;
        refreshModelRow();
      }

      function saveSecretFromInput(input: HTMLInputElement | HTMLSelectElement, button: HTMLButtonElement): void {
        const key = input.dataset.secret as RuntimeSecretKey | undefined;
        if (!key) return;
        const raw = input.value.trim();
        const hint = input.closest('.data-source-secret-row')?.querySelector<HTMLElement>('[data-hint]');
        if (!raw || raw === MASKED_SENTINEL) {
          if (hint) { hint.hidden = false; hint.textContent = 'Enter a value first'; }
          return;
        }

        const result = validateSecret(key, raw);
        if (!result.valid) {
          if (hint) { hint.hidden = false; hint.textContent = result.hint || 'Invalid value'; }
          return;
        }
        if (hint) hint.hidden = true;

        button.disabled = true;
        const originalLabel = button.textContent;
        button.textContent = 'Saving…';

        void setSecretValue(key, raw).then(() => {
          // Non-plaintext (actual secret) values are never echoed back,
          // matching the vault's write-only contract — clear the field and
          // let the placeholder confirm it saved. Plaintext values (URLs,
          // etc.) aren't sensitive, so keep showing what was just typed
          // rather than blanking a field that "worked."
          if (PLAINTEXT_KEYS.has(key)) {
            input.value = raw;
          } else {
            input.value = '';
            if (input instanceof HTMLInputElement) input.placeholder = t('modals.runtimeConfig.placeholder.configured');
          }
          for (const feature of featuresUsingSecret(key)) updateFeatureStatus(feature);
          updateSummary();
          if (hint) { hint.hidden = false; hint.textContent = 'Saved'; hint.classList.add('data-source-hint-ok'); }

          // Saving a new OLLAMA_API_URL invalidates any model list fetched
          // for the previous one — drop straight back to a text input, then
          // silently re-fetch in the background so a confirmed-good save
          // upgrades OLLAMA_MODEL to a dropdown without requiring a
          // separate manual "Test Connection" click. Two independent sources,
          // same reasoning as testConnectionFromInput below: the server-side
          // verify is the one that actually works for self-hosted Docker
          // (host.docker.internal isn't resolvable from the browser), the
          // direct client fetch is a same-host shortcut for desktop.
          if (key === 'OLLAMA_API_URL') {
            ollamaModelCache = null;
            refreshModelRow();
            void verifySecretWithApi(key, raw).then((result) => adoptOllamaModels(result.models))
              .catch(() => { /* silent — Test Connection remains available if this fails */ });
            void fetchOllamaModels(raw).then(adoptOllamaModels)
              .catch(() => { /* silent — Test Connection remains available if this fails */ });
          }
        }).catch((err: unknown) => {
          if (hint) {
            hint.hidden = false;
            hint.classList.remove('data-source-hint-ok');
            hint.textContent = err instanceof Error ? err.message : 'Failed to save';
          }
        }).finally(() => {
          button.disabled = !canEditRuntimeConfig();
          button.textContent = originalLabel;
        });
      }

      function testConnectionFromInput(input: HTMLInputElement, button: HTMLButtonElement): void {
        const key = input.dataset.secret as RuntimeSecretKey | undefined;
        if (!key) return;
        const raw = input.value.trim();
        const hint = input.closest('.data-source-secret-row')?.querySelector<HTMLElement>('[data-hint]');
        if (!raw) {
          if (hint) { hint.hidden = false; hint.classList.remove('data-source-hint-ok'); hint.textContent = 'Enter a value to test'; }
          return;
        }

        button.disabled = true;
        const originalLabel = button.textContent;
        button.textContent = 'Testing…';

        void verifySecretWithApi(key, raw).then((result) => {
          if (hint) {
            hint.hidden = false;
            hint.classList.toggle('data-source-hint-ok', result.valid);
            hint.textContent = result.message;
          }
          // result.models comes from the SAME server-side probe that just
          // produced result.valid — the only source that works for
          // self-hosted Docker, where OLLAMA_API_URL is typically
          // host.docker.internal and unresolvable from the browser itself.
          // Also try a direct client-side fetch (same mechanism desktop's
          // RuntimeConfigPanel uses): same-host on desktop, so it can
          // succeed even in the rare case the proxied probe doesn't, or
          // vice versa (e.g. CORS blocks the direct fetch but not the
          // sidecar). Neither call overwrites a good list with an empty one.
          if (key === 'OLLAMA_API_URL') {
            adoptOllamaModels(result.models);
            void fetchOllamaModels(raw).then(adoptOllamaModels);
          }
        }).catch((err: unknown) => {
          if (hint) {
            hint.hidden = false;
            hint.classList.remove('data-source-hint-ok');
            hint.textContent = err instanceof Error ? err.message : 'Test failed';
          }
        }).finally(() => {
          button.disabled = !canEditRuntimeConfig();
          button.textContent = originalLabel;
        });
      }

      /**
       * Wires one secret row's control (an <input> or, for OLLAMA_MODEL once
       * models are known, a <select> — both expose the same
       * value/dataset/closest surface) plus its Save/Test buttons. Scoped to
       * a single row's subtree (not the whole container) so refreshModelRow
       * can re-wire just the one row it replaces without re-registering
       * listeners on every other, unaffected row.
       */
      function attachSecretRowListeners(row: HTMLElement): void {
        const control = row.querySelector<HTMLInputElement | HTMLSelectElement>('[data-secret]');
        if (control) {
          control.addEventListener('keydown', (e) => {
            const ke = e as KeyboardEvent;
            if (ke.key !== 'Enter') return;
            ke.preventDefault();
            row.querySelector<HTMLButtonElement>('[data-save-secret]')?.click();
          }, { signal });
          control.addEventListener(control instanceof HTMLSelectElement ? 'change' : 'input', () => {
            const hint = row.querySelector<HTMLElement>('[data-hint]');
            if (hint) { hint.hidden = true; hint.classList.remove('data-source-hint-ok'); }
          }, { signal });
        }

        const saveBtn = row.querySelector<HTMLButtonElement>('[data-save-secret]');
        saveBtn?.addEventListener('click', () => {
          if (control) saveSecretFromInput(control, saveBtn);
        }, { signal });

        const testBtn = row.querySelector<HTMLButtonElement>('[data-test-secret]');
        if (testBtn && control instanceof HTMLInputElement) {
          testBtn.addEventListener('click', () => testConnectionFromInput(control, testBtn), { signal });
        }
      }

      function attachListRowListeners(): void {
        container.querySelectorAll<HTMLInputElement>('input[data-toggle]').forEach((input) => {
          input.addEventListener('change', () => {
            const featureId = input.dataset.toggle as RuntimeFeatureDefinition['id'] | undefined;
            if (!featureId) return;
            setFeatureToggle(featureId, input.checked);
            const feature = RUNTIME_FEATURES.find((f) => f.id === featureId);
            if (feature) { updateFeatureStatus(feature); updateSummary(); }
          }, { signal });
        });

        container.querySelectorAll<HTMLElement>('[data-secret-row]').forEach((row) => attachSecretRowListeners(row));
      }

      container.querySelector<HTMLButtonElement>('[data-data-sources-signin]')?.addEventListener('click', () => signIn(), { signal });

      attachListRowListeners();

      // Now that loadSelfHostedSecretStatus() returns real values for
      // PLAINTEXT_KEYS (not just presence), the OLLAMA_API_URL value is
      // known as soon as secrets finish loading — proactively fetch models
      // so the dropdown is populated on open, instead of only after the
      // user clicks Test Connection or re-saves the URL this session.
      void secretsReady.then(() => {
        if (ollamaModelCache !== null) return;
        const url = getRuntimeConfigSnapshot().secrets.OLLAMA_API_URL?.value;
        if (!url) return;
        // This path is self-hosted-only in practice (desktop's loadDesktopSecrets
        // never populates .value, so `url` above is undefined there and this
        // bails before reaching here) — which makes the server-side probe the
        // ONLY source that can work: a direct client fetch would try to resolve
        // host.docker.internal from the browser and silently fail every time.
        void verifySecretWithApi('OLLAMA_API_URL', url).then((result) => adoptOllamaModels(result.models))
          .catch(() => { /* silent — Test Connection remains available if this fails */ });
        void fetchOllamaModels(url).then(adoptOllamaModels);
      });

      // Deliberately NOT subscribed to subscribeRuntimeConfig here: both
      // setSecretValue and setFeatureToggle call notifyConfigChanged()
      // internally, which would fire a redundant full-list rebuild right
      // after the targeted update above on every single save — a jarring
      // flash for no benefit. Auth state (sign-in/out) is the one broad
      // shift that genuinely needs the full rebuild (every row's disabled
      // state changes), so only that stays subscribed.
      const unsubscribeAuth = subscribeAuthState(rerenderList);

      return () => {
        ac.abort();
        unsubscribeAuth();
      };
    },
  };
}

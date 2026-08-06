/**
 * Quick Settings — Web-only user preferences for AI pipeline and map behavior.
 * Desktop (Tauri) manages AI config via its own settings window.
 *
 * TODO: Migrate panel visibility, sources, and language selector into this
 *       settings hub once the UI is extended with additional sections.
 */

import { isDesktopRuntime, isSelfHostedRuntime } from './runtime';
import { isFeatureAvailable } from './runtime-config';

const STORAGE_KEY_BROWSER_MODEL = 'wm-ai-flow-browser-model';
const STORAGE_KEY_CLOUD_LLM = 'wm-ai-flow-cloud-llm';
const STORAGE_KEY_MAP_NEWS_FLASH = 'wm-map-news-flash';
const STORAGE_KEY_HEADLINE_MEMORY = 'wm-headline-memory';
const STORAGE_KEY_BADGE_ANIMATION = 'wm-badge-animation';
const STORAGE_KEY_STREAM_QUALITY = 'wm-stream-quality';
const EVENT_NAME = 'ai-flow-changed';
const STREAM_QUALITY_EVENT = 'stream-quality-changed';

export interface AiFlowSettings {
  browserModel: boolean;
  cloudLlm: boolean;
  mapNewsFlash: boolean;
  headlineMemory: boolean;
  badgeAnimation: boolean;
}

function readBool(key: string, defaultValue: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return raw === 'true';
  } catch {
    return defaultValue;
  }
}

function writeBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Quota or private-browsing; silently ignore
  }
}

const STORAGE_KEY_MAP: Record<keyof AiFlowSettings, string> = {
  browserModel: STORAGE_KEY_BROWSER_MODEL,
  cloudLlm: STORAGE_KEY_CLOUD_LLM,
  mapNewsFlash: STORAGE_KEY_MAP_NEWS_FLASH,
  headlineMemory: STORAGE_KEY_HEADLINE_MEMORY,
  badgeAnimation: STORAGE_KEY_BADGE_ANIMATION,
};

const DEFAULTS: AiFlowSettings = {
  browserModel: false,
  cloudLlm: true,
  mapNewsFlash: true,
  headlineMemory: false,
  badgeAnimation: false,
};

export function getAiFlowSettings(): AiFlowSettings {
  return {
    browserModel: readBool(STORAGE_KEY_BROWSER_MODEL, DEFAULTS.browserModel),
    cloudLlm: readBool(STORAGE_KEY_CLOUD_LLM, DEFAULTS.cloudLlm),
    mapNewsFlash: readBool(STORAGE_KEY_MAP_NEWS_FLASH, DEFAULTS.mapNewsFlash),
    headlineMemory: readBool(STORAGE_KEY_HEADLINE_MEMORY, DEFAULTS.headlineMemory),
    badgeAnimation: readBool(STORAGE_KEY_BADGE_ANIMATION, DEFAULTS.badgeAnimation),
  };
}

/**
 * Effective Headline Memory state. Headline Memory implementation requires
 * a local embeddings model in the ML worker, so on web it can only function
 * when the Browser Local Model parent toggle is also enabled — otherwise
 * we'd silently download/run an ML model the user opted out of via the
 * parent toggle. The persisted value is preserved (the settings UI reads
 * `getAiFlowSettings().headlineMemory` for the raw value) so re-enabling
 * Browser Local Model restores the user's prior Headline Memory choice.
 *
 * The Browser Local Model toggle is web-only — `preferences-content.ts`
 * skips rendering it on desktop, and `App.ts` initializes the ML worker
 * unconditionally on desktop. So the parent gate must be skipped on
 * desktop, otherwise Headline Memory would be silently dead on every
 * desktop install (the hidden web key never flips to true).
 */
export function isHeadlineMemoryEnabled(): boolean {
  const headline = readBool(STORAGE_KEY_HEADLINE_MEMORY, DEFAULTS.headlineMemory);
  if (!headline) return false;
  if (isDesktopRuntime()) return true;
  const browser = readBool(STORAGE_KEY_BROWSER_MODEL, DEFAULTS.browserModel);
  return browser;
}

export function setAiFlowSetting(key: keyof AiFlowSettings, value: boolean): void {
  writeBool(STORAGE_KEY_MAP[key], value);
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { key } }));
}

/**
 * Fires the same event setAiFlowSetting dispatches, without writing any
 * ai-flow-settings storage key — for state that affects
 * isAnyAiProviderEnabled() but lives elsewhere (runtime-config.ts's aiOllama
 * feature toggle, set via setFeatureToggle from the Data Sources tab or the
 * Preferences "Want fully local AI?" switch). Without this, flipping Ollama
 * on/off has no subscriber to tell InsightsPanel to re-check
 * isAnyAiProviderEnabled() and leave/enter its disabled state — the panel
 * would sit on a stale "AI analysis is disabled" (or stale live state) until
 * some unrelated event happened to trigger a refresh.
 */
export function notifyExternalAiProviderChange(): void {
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: {} }));
}

/**
 * Ollama bypasses cloudLlm/browserModel entirely — summarization.ts always
 * tries it first, regardless of either toggle (see the "Ollama is local
 * infrastructure" comment there). This module's two toggles used to be the
 * ONLY thing this function checked, so a self-hosted user who turns OFF both
 * Cloud AI and Browser Local Model to run Ollama-only got told "AI analysis
 * is disabled" by InsightsPanel.ts even though Ollama was exactly what would
 * have run. isFeatureAvailable('aiOllama') is scoped to desktop/self-hosted
 * on purpose — on hosted SaaS there's no Data Sources tab to configure
 * OLLAMA_API_URL at all, and isFeatureAvailable's own hosted-web branch would
 * otherwise report "available" from the feature-toggle default alone with
 * nothing behind it.
 */
export function isAnyAiProviderEnabled(): boolean {
  const s = getAiFlowSettings();
  if (s.cloudLlm || s.browserModel) return true;
  if (!isDesktopRuntime() && !isSelfHostedRuntime()) return false;
  return isFeatureAvailable('aiOllama');
}

export function subscribeAiFlowChange(cb: (changedKey?: keyof AiFlowSettings) => void): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail as { key?: keyof AiFlowSettings } | undefined;
    cb(detail?.key);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}

// ── Stream Quality ──

export type StreamQuality = 'auto' | 'small' | 'medium' | 'large' | 'hd720';

export const STREAM_QUALITY_OPTIONS: { value: StreamQuality; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'small', label: 'Low (360p)' },
  { value: 'medium', label: 'Medium (480p)' },
  { value: 'large', label: 'High (480p+)' },
  { value: 'hd720', label: 'HD (720p)' },
];

export function getStreamQuality(): StreamQuality {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_STREAM_QUALITY);
    if (raw && ['auto', 'small', 'medium', 'large', 'hd720'].includes(raw)) return raw as StreamQuality;
  } catch { /* ignore */ }
  return 'auto';
}

export function setStreamQuality(quality: StreamQuality): void {
  try {
    localStorage.setItem(STORAGE_KEY_STREAM_QUALITY, quality);
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(STREAM_QUALITY_EVENT, { detail: { quality } }));
}

export function subscribeStreamQualityChange(cb: (quality: StreamQuality) => void): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail as { quality: StreamQuality };
    cb(detail.quality);
  };
  window.addEventListener(STREAM_QUALITY_EVENT, handler);
  return () => window.removeEventListener(STREAM_QUALITY_EVENT, handler);
}

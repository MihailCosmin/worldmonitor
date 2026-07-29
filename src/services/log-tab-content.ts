/**
 * "Log" settings tab — for every panel, map layer, and data source, shows
 * whether it's currently working and, if not, why (a source problem, an AI
 * provider problem, a generic RPC failure, or genuinely not monitored yet).
 *
 * Reuses three existing tiers of truth, in priority order, rather than
 * re-instrumenting everything from scratch:
 *   1. data-freshness.ts — the ~35 already-tracked feed sources, plus any
 *      panel with a PANEL_FRESHNESS_SOURCES entry (rich detail via
 *      panel-freshness-display.ts's existing formatter).
 *   2. component-health.ts — generic success/failure recorded by
 *      data-loader.ts's runGuarded/loadDataForLayer and premium-fetch.ts's
 *      componentId option (see summarization.ts for the AI-chain case,
 *      which gets a real classified reason instead of a generic one).
 *   3. STATIC_LAYERS/STATIC_PANELS (panels.ts) for things with no live
 *      dependency at all, else 'unknown' — never silently omitted.
 */
import {
  ALL_PANELS,
  PANEL_CATEGORY_MAP,
  LAYER_TO_SOURCE,
  STATIC_LAYERS,
  STATIC_PANELS,
} from '@/config/panels';
import { LAYER_REGISTRY, LAYER_EXPLANATIONS } from '@/config/map-layer-definitions';
import { SITE_VARIANT } from '@/config/variant';
import { dataFreshness, type FreshnessStatus, type DataSourceId } from '@/services/data-freshness';
import { formatPanelFreshnessDisplay } from '@/services/panel-freshness-display';
import { componentHealth } from '@/services/component-health';
import { escapeHtml } from '@/utils/sanitize';
import { setTrustedHtml, trustedHtml } from '@/utils/dom-utils';
import { t } from '@/services/i18n';
import type { MapLayers } from '@/types';

export interface LogTabResult {
  html: string;
  attach: (container: HTMLElement) => () => void;
}

type RowStatus = 'ok' | 'degraded' | 'error' | 'static' | 'unknown';

interface LogRow {
  id: string;
  label: string;
  status: RowStatus;
  detail: string;
}

const STATUS_LABEL: Record<RowStatus, string> = {
  ok: 'OK',
  degraded: 'Degraded',
  error: 'Error',
  static: 'Static',
  unknown: 'Not monitored',
};

function freshnessToRowStatus(status: FreshnessStatus): RowStatus {
  switch (status) {
    case 'fresh':
    case 'stale':
      return 'ok';
    case 'very_stale':
    case 'no_data':
      return 'degraded';
    case 'error':
      return 'error';
    case 'disabled':
      return 'unknown';
  }
}

const SOURCE_STATUS_SEVERITY: Record<FreshnessStatus, number> = {
  fresh: 0, disabled: 1, stale: 2, very_stale: 3, no_data: 4, error: 5,
};

/** Mirrors data-freshness.ts's own worst-status-wins reduction (private to
 * that module), applied to an arbitrary DataSourceId list — used for map
 * layers via LAYER_TO_SOURCE, which is keyed by layer, not by panel, so
 * dataFreshness.getPanelFreshness() (panel-keyed) can't be reused directly. */
function resolveFreshnessForSourceIds(sourceIds: DataSourceId[]): { status: RowStatus; detail: string } | null {
  const sources = sourceIds
    .map((id) => dataFreshness.getSource(id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s));
  if (sources.length === 0) return null;
  const worst = sources.reduce((w, s) => (SOURCE_STATUS_SEVERITY[s.status] > SOURCE_STATUS_SEVERITY[w.status] ? s : w), sources[0]!);
  const detail = sources
    .map((s) => `${s.name}: ${s.lastError ?? (s.lastUpdate ? `updated ${s.lastUpdate.toLocaleString()}` : 'no data')}`)
    .join('; ');
  return { status: freshnessToRowStatus(worst.status), detail };
}

function resolveComponentRow(
  id: string,
  label: string,
  staticSet: Set<string>,
  sourceIds?: DataSourceId[],
): LogRow {
  const panelFreshness = dataFreshness.getPanelFreshness(id);
  if (panelFreshness) {
    const display = formatPanelFreshnessDisplay(panelFreshness);
    return { id, label, status: freshnessToRowStatus(panelFreshness.status), detail: display.title };
  }

  if (sourceIds && sourceIds.length > 0) {
    const resolved = resolveFreshnessForSourceIds(sourceIds);
    if (resolved) return { id, label, status: resolved.status, detail: resolved.detail };
  }

  const record = componentHealth.getRecord(`panel:${id}`) ?? componentHealth.getRecord(`layer:${id}`);
  if (record) {
    return {
      id,
      label,
      status: record.status === 'ok' ? 'ok' : 'error',
      detail: record.detail ?? (record.status === 'ok' ? 'Last check succeeded' : 'Last check failed'),
    };
  }

  if (staticSet.has(id)) {
    return { id, label, status: 'static', detail: 'No live dependency — bundled or computed data' };
  }

  return { id, label, status: 'unknown', detail: 'Not yet monitored' };
}

function buildPanelCategoryIndex(): Map<string, string> {
  const index = new Map<string, string>();
  for (const def of Object.values(PANEL_CATEGORY_MAP)) {
    if (def.variants && !def.variants.includes(SITE_VARIANT)) continue;
    const label = t(def.labelKey, { defaultValue: def.labelKey });
    for (const panelKey of def.panelKeys) {
      if (!index.has(panelKey)) index.set(panelKey, label);
    }
  }
  return index;
}

function buildPanelSections(): Array<{ category: string; rows: LogRow[] }> {
  const categoryIndex = buildPanelCategoryIndex();
  const grouped = new Map<string, LogRow[]>();
  for (const [panelId, config] of Object.entries(ALL_PANELS)) {
    const category = categoryIndex.get(panelId) ?? 'Other';
    const row = resolveComponentRow(panelId, config.name, STATIC_PANELS);
    const rows = grouped.get(category) ?? [];
    rows.push(row);
    grouped.set(category, rows);
  }
  return Array.from(grouped.entries())
    .map(([category, rows]) => ({ category, rows: rows.sort((a, b) => a.label.localeCompare(b.label)) }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

function buildLayerSections(): Array<{ category: string; rows: LogRow[] }> {
  const grouped = new Map<string, LogRow[]>();
  for (const layerKey of Object.keys(LAYER_REGISTRY) as (keyof MapLayers)[]) {
    const def = LAYER_REGISTRY[layerKey];
    const category = LAYER_EXPLANATIONS[layerKey]?.category ?? 'Other';
    const row = resolveComponentRow(layerKey, def.fallbackLabel, STATIC_LAYERS as Set<string>, LAYER_TO_SOURCE[layerKey]);
    const rows = grouped.get(category) ?? [];
    rows.push(row);
    grouped.set(category, rows);
  }
  return Array.from(grouped.entries())
    .map(([category, rows]) => ({ category, rows: rows.sort((a, b) => a.label.localeCompare(b.label)) }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

function buildSourceSection(): LogRow[] {
  return dataFreshness.getAllSources()
    .map((source) => ({
      id: source.id,
      label: source.name,
      status: freshnessToRowStatus(source.status),
      detail: source.lastError
        ?? (source.lastUpdate ? `Last updated ${source.lastUpdate.toLocaleString()}` : 'Never updated'),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function renderRow(row: LogRow): string {
  return `
    <div class="log-tab-row">
      <span class="log-tab-pill log-tab-pill-${row.status}">${escapeHtml(STATUS_LABEL[row.status])}</span>
      <span class="log-tab-row-label">${escapeHtml(row.label)}</span>
      <span class="log-tab-row-detail">${escapeHtml(row.detail)}</span>
    </div>
  `;
}

function renderSection(title: string, sections: Array<{ category: string; rows: LogRow[] }>): string {
  const total = sections.reduce((sum, s) => sum + s.rows.length, 0);
  const okCount = sections.reduce((sum, s) => sum + s.rows.filter(r => r.status === 'ok' || r.status === 'static').length, 0);
  return `
    <section class="log-tab-section">
      <h3 class="log-tab-section-title">${escapeHtml(title)} <span class="log-tab-section-count">${okCount}/${total}</span></h3>
      ${sections.map(({ category, rows }) => `
        <div class="log-tab-category">
          <h4 class="log-tab-category-title">${escapeHtml(category)}</h4>
          ${rows.map(renderRow).join('')}
        </div>
      `).join('')}
    </section>
  `;
}

function renderFlatSection(title: string, rows: LogRow[]): string {
  const okCount = rows.filter(r => r.status === 'ok' || r.status === 'static').length;
  return `
    <section class="log-tab-section">
      <h3 class="log-tab-section-title">${escapeHtml(title)} <span class="log-tab-section-count">${okCount}/${rows.length}</span></h3>
      ${rows.map(renderRow).join('')}
    </section>
  `;
}

export function renderLogTabContent(): LogTabResult {
  function buildHtml(): string {
    return `
      <div class="log-tab-content">
        ${renderSection('Panels', buildPanelSections())}
        ${renderSection('Map Layers', buildLayerSections())}
        ${renderFlatSection('Data Sources', buildSourceSection())}
      </div>
    `;
  }

  return {
    html: buildHtml(),
    attach(container: HTMLElement): () => void {
      const rerender = () => {
        setTrustedHtml(container, trustedHtml(buildHtml(), 'legacy direct innerHTML migration'));
      };
      const unsubscribeFreshness = dataFreshness.subscribe(rerender);
      const unsubscribeHealth = componentHealth.subscribe(rerender);
      return () => {
        unsubscribeFreshness();
        unsubscribeHealth();
      };
    },
  };
}

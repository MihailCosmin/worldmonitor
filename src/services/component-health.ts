/**
 * Component Health Tracker
 *
 * General-purpose success/error recording for panels and AI/RPC call sites
 * that the Settings > Log tab surfaces alongside data-freshness.ts's
 * existing per-source tracking. String-keyed (not a closed enum like
 * DataSourceId) since panels + map layers number in the hundreds combined —
 * a closed union at that scale isn't worth maintaining.
 *
 * This is deliberately a thin recording primitive only. It doesn't know
 * about panel names, categories, or which ids "should" exist — that
 * aggregation (resolving a display row for every panel/layer/source,
 * falling back to data-freshness.ts or a static/unknown tag when nothing
 * has ever been recorded for an id) lives in log-tab-content.ts, the one
 * place that actually needs the full picture.
 */

export type ComponentHealthStatus = 'ok' | 'error';

export interface ComponentHealthRecord {
  status: ComponentHealthStatus;
  detail: string | null;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
}

class ComponentHealthTracker {
  private records = new Map<string, ComponentHealthRecord>();
  private listeners = new Set<() => void>();

  recordSuccess(id: string, detail?: string): void {
    const existing = this.records.get(id);
    this.records.set(id, {
      status: 'ok',
      detail: detail ?? null,
      lastSuccessAt: Date.now(),
      lastErrorAt: existing?.lastErrorAt ?? null,
    });
    this.notify();
  }

  recordError(id: string, message: string): void {
    const existing = this.records.get(id);
    this.records.set(id, {
      status: 'error',
      detail: message,
      lastSuccessAt: existing?.lastSuccessAt ?? null,
      lastErrorAt: Date.now(),
    });
    this.notify();
  }

  getRecord(id: string): ComponentHealthRecord | undefined {
    return this.records.get(id);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export const componentHealth = new ComponentHealthTracker();

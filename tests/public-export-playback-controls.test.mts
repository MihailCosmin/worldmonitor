import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const EVENT_HANDLERS_TS = readFileSync(resolve(REPO_ROOT, 'src/app/event-handlers.ts'), 'utf8');
const ANALYTICS_TS = readFileSync(resolve(REPO_ROOT, 'src/services/analytics.ts'), 'utf8');

function section(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing section start: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing section end: ${endMarker}`);
  return source.slice(start, end);
}

describe('export and playback controls stay public', () => {
  const exportSection = section(
    EVENT_HANDLERS_TS,
    'setupExportPanel(): void {',
    'setupUnifiedSettings(): void {',
  );
  const playbackSection = section(
    EVENT_HANDLERS_TS,
    'setupPlaybackControl(): void {',
    'setupSnapshotSaving(): void {',
  );

  it('mounts the global export control without a Pro gate', () => {
    assert.match(
      exportSection,
      /void ensureExportPanel\(\)\.catch\(/,
      'setupExportPanel() should mount the export control for every user state',
    );
    assert.doesNotMatch(
      exportSection,
      /role === 'pro'|role==='pro'|getAuthState\(\)|subscribeAuthState\(|trackGateHit\('export'\)|applyProGate|currentIsPro/,
      'setupExportPanel() must not hide export behind Pro role checks or gate-hit telemetry',
    );
  });

  it('mounts playback without a Pro gate', () => {
    assert.match(
      playbackSection,
      /this\.ctx\.playbackControl = new PlaybackControl\(\);/,
      'setupPlaybackControl() should always create the playback control',
    );
    assert.doesNotMatch(
      playbackSection,
      /role === 'pro'|role==='pro'|getAuthState\(\)|subscribeAuthState\(|trackGateHit\('playback'\)|applyProGate|style\.display\s*=\s*isPro/,
      'setupPlaybackControl() must not hide playback behind Pro role checks or gate-hit telemetry',
    );
  });

  it('removes stale gate-hit analytics plumbing once no callers remain', () => {
    assert.doesNotMatch(
      EVENT_HANDLERS_TS,
      /trackGateHit/,
      'event-handlers.ts should not import or call trackGateHit after export/playback ungating',
    );
    assert.doesNotMatch(
      EVENT_HANDLERS_TS,
      /proGateUnsubscribers/,
      'event-handlers.ts should not keep dead auth-gate unsubscribe bookkeeping',
    );
    assert.doesNotMatch(
      ANALYTICS_TS,
      /export function trackGateHit\(/,
      'analytics.ts should remove the unused trackGateHit helper',
    );
    assert.doesNotMatch(
      ANALYTICS_TS,
      /'gate-hit': true/,
      'analytics.ts should remove the stale gate-hit event catalog entry once no public caller remains',
    );
  });
});

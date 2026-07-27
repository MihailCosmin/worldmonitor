import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const SEARCH_MANAGER_TS = readFileSync(resolve(REPO_ROOT, 'src/app/search-manager.ts'), 'utf8');
const LOCALES_DIR = resolve(REPO_ROOT, 'src/locales');

function section(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing section start: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing section end: ${endMarker}`);
  return source.slice(start, end);
}

describe('live flight search stays public', () => {
  const setupSection = section(
    SEARCH_MANAGER_TS,
    'private setupSearchModal(): void {',
    'private registerBaseSearchSource(): void {',
  );
  const updateFlightSourceSection = section(
    SEARCH_MANAGER_TS,
    'updateFlightSource(adsb: PositionSample[], military: MilitaryFlight[]): void {',
    'updateSearchIndex(): void {',
  );

  it('registers and executes the callsign flight source without a Pro gate', () => {
    assert.match(
      setupSection,
      /registerSource\('flight', \[\]\);/,
      'setupSearchModal() should seed the flight source for every user state',
    );
    assert.match(
      setupSection,
      /setOnFlightSearch\(\(callsign\) => \{\s*fetchAircraftPositions\(\{ callsign \}\)/s,
      'callsign search should always execute the live flight fetch',
    );
    assert.doesNotMatch(
      setupSection,
      /setOnFlightSearch\(\(callsign\) => \{[\s\S]*?(isProUser\(\)|getAuthState\(\))/s,
      'callsign search must not early-return behind a Pro gate',
    );
  });

  it('populates the live flight search source for all users', () => {
    assert.match(
      updateFlightSourceSection,
      /if \(!this\.ctx\.searchModal\) return;/,
      'updateFlightSource() should only depend on the modal existing',
    );
    assert.match(
      updateFlightSourceSection,
      /this\.ctx\.searchModal\.registerSource\('flight', items\);/,
      'updateFlightSource() should publish indexed flight results into the shared search source',
    );
    assert.doesNotMatch(
      updateFlightSourceSection,
      /isProUser\(\)|getAuthState\(\)/,
      'updateFlightSource() must not skip public flight indexing based on plan tier',
    );
  });

  it('removes the Pro label from live flight search in every locale', () => {
    const localeFiles = readdirSync(LOCALES_DIR)
      .filter((name) => name.endsWith('.json') && name !== 'en.shell.json')
      .sort();

    for (const file of localeFiles) {
      const locale = JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf8'));
      const flightLabel = locale?.commands?.tips?.flight;
      assert.equal(typeof flightLabel, 'string', `${file} should define commands.tips.flight`);
      assert.doesNotMatch(
        flightLabel,
        /\bPRO\b|\(PRO\)/,
        `${file} should not label live flight search as Pro-only`,
      );
    }
  });
});

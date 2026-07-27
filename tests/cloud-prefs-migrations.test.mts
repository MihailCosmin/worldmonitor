import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { applyMigrationChain, buildMigrations } from '../src/utils/cloud-prefs-migrations.ts';

describe('cloud-prefs migration helpers', () => {
  it('runs no migrations when fromVersion >= toVersion', () => {
    let calls = 0;
    const migrations = { 2: (data: Record<string, unknown>) => { calls++; return data; } };
    const data = { foo: 'bar' };
    const result = applyMigrationChain(data, 2, 2, migrations);
    assert.equal(calls, 0, 'no migrations should run when already at target');
    assert.equal(result, data);
  });

  it('runs migrations in order from fromVersion + 1 to toVersion inclusive', () => {
    const calledFor: number[] = [];
    const migrations = {
      2: (data: Record<string, unknown>) => { calledFor.push(2); return { ...data, m2: true }; },
      3: (data: Record<string, unknown>) => { calledFor.push(3); return { ...data, m3: true }; },
    };
    const result = applyMigrationChain({}, 1, 3, migrations);
    assert.deepEqual(calledFor, [2, 3]);
    assert.equal((result as { m2?: boolean }).m2, true);
    assert.equal((result as { m3?: boolean }).m3, true);
  });

  it('skips missing migrations in a sparse map', () => {
    const migrations = {
      3: (data: Record<string, unknown>) => ({ ...data, m3: true }),
    };
    const result = applyMigrationChain({ initial: true }, 1, 3, migrations);
    assert.equal((result as { initial?: boolean }).initial, true);
    assert.equal((result as { m3?: boolean }).m3, true);
  });

  it('returns an empty migration map after free-plan cap recovery removal', () => {
    assert.deepEqual(buildMigrations(), {});
  });
});

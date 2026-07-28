import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PREMIUM_RPC_PATHS } from '../src/shared/premium-paths.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// ENDPOINT_ENTITLEMENTS is intentionally module-private (server/_shared/entitlement-check.ts
// exports only getRequiredTier()) — parse the object literal's keys from source, same
// approach as tests/route-cache-tier.test.mjs uses for another private-const registry.
function extractEndpointEntitlementKeys() {
  const src = readFileSync(join(root, 'server', '_shared', 'entitlement-check.ts'), 'utf-8');
  const match = src.match(/const ENDPOINT_ENTITLEMENTS: Record<string, number> = \{([\s\S]*?)\};/);
  assert.ok(match, 'could not locate ENDPOINT_ENTITLEMENTS object literal in entitlement-check.ts');
  const body = match[1];
  const keys = [];
  const re = /'([^']+)':\s*\d+/g;
  let m;
  while ((m = re.exec(body)) !== null) keys.push(m[1]);
  return keys;
}

// Mirrors docs/architecture/paid-capability-allowlist.md's "Hard gates" table.
// A new entry here means a new upgrade prompt somewhere on a public surface —
// update the allowlist doc in the same PR, don't just make this test pass.
const EXPECTED_PREMIUM_RPC_PATHS = [
  '/api/intelligence/v1/classify-event',
  '/api/forecast/v1/trigger-simulation',
  '/api/v2/shipping/route-intelligence',
  '/api/v2/shipping/webhooks',
  '/api/mcp-proxy',
].sort();

const EXPECTED_ENDPOINT_ENTITLEMENTS = [
  '/api/forecast/v1/trigger-simulation',
  '/api/intelligence/v1/classify-event',
].sort();

describe('paid-capability allowlist (docs/architecture/paid-capability-allowlist.md)', () => {
  it('PREMIUM_RPC_PATHS matches the documented allowlist exactly', () => {
    const actual = [...PREMIUM_RPC_PATHS].sort();
    assert.deepEqual(
      actual,
      EXPECTED_PREMIUM_RPC_PATHS,
      'src/shared/premium-paths.ts drifted from docs/internal/paid-capability-allowlist.md — ' +
        'update the allowlist doc (and this test) in the same PR as any gating change',
    );
  });

  it('ENDPOINT_ENTITLEMENTS matches the documented allowlist exactly', () => {
    const actual = extractEndpointEntitlementKeys().sort();
    assert.deepEqual(
      actual,
      EXPECTED_ENDPOINT_ENTITLEMENTS,
      'server/_shared/entitlement-check.ts drifted from docs/internal/paid-capability-allowlist.md — ' +
        'update the allowlist doc (and this test) in the same PR as any gating change',
    );
  });

  it('every ENDPOINT_ENTITLEMENTS path is also in PREMIUM_RPC_PATHS (documented overlap)', () => {
    for (const path of extractEndpointEntitlementKeys()) {
      assert.ok(
        PREMIUM_RPC_PATHS.has(path),
        `${path} is tier-gated in ENDPOINT_ENTITLEMENTS but missing from PREMIUM_RPC_PATHS — ` +
          'the two registries are documented as overlapping on these paths by design',
      );
    }
  });
});

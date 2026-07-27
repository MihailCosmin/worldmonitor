/**
 * Cloud-prefs schema migrations and conflict-merge, isolated from
 * cloud-prefs-sync.ts so they stay testable without importing the full sync
 * runtime (which transitively pulls in `import.meta.env.DEV` via
 * `@/services/clerk` → proxy.ts and fails outside a Vite build).
 *
 * Each migration is a pure function from blob → blob. The map is keyed by
 * the TARGET schema version (so MIGRATIONS[N] runs when going from N-1 → N).
 */

/**
 * Apply all migrations from `fromVersion + 1` up through `toVersion`
 * inclusive. Pure function — no I/O. Caller controls migrations map and
 * feeds context. Extracted for direct testing without pulling in the
 * cloud-prefs-sync runtime (which has a Vite-env transitive import).
 */
export function applyMigrationChain(
  data: Record<string, unknown>,
  fromVersion: number,
  toVersion: number,
  migrations: Record<number, (data: Record<string, unknown>) => Record<string, unknown>>,
): Record<string, unknown> {
  let result = data;
  for (let v = fromVersion + 1; v <= toVersion; v++) {
    result = migrations[v]?.(result) ?? result;
  }
  return result;
}

/**
 * Conflict-resolution merge for cloud-prefs sync.
 *
 * When a POST to /api/user-prefs hits a 409 (the cloud row advanced under
 * us), the local edits the user JUST made must not be discarded. The old
 * behaviour fetched the fresh cloud row and overwrote localStorage with it
 * wholesale — silently destroying, e.g., a watchlist the user typed seconds
 * earlier. This merge resolves the conflict without data loss:
 *
 *   - Start from the fresh cloud blob (so a concurrent change from another
 *     device survives).
 *   - Overlay the keys the user changed locally since the last clean upload
 *     (`dirtyKeys`): a dirty key present in `localBlob` → the local value
 *     wins; a dirty key ABSENT from `localBlob` → the user removed it
 *     locally → drop it from the merge so the removal sticks.
 *
 * Pure function — no I/O. `cloudData` is the migrated cloud blob, `localBlob`
 * is the current localStorage snapshot, `dirtyKeys` is the set of sync keys
 * mutated locally since the last clean upload. Extracted here (not in
 * cloud-prefs-sync.ts) so it stays unit-testable without the sync runtime.
 */
export function mergeCloudWithLocalDirty(
  cloudData: Record<string, unknown>,
  localBlob: Record<string, string>,
  dirtyKeys: Iterable<string>,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, val] of Object.entries(cloudData)) {
    if (typeof val === 'string') merged[key] = val;
  }
  for (const key of dirtyKeys) {
    if (Object.prototype.hasOwnProperty.call(localBlob, key)) {
      merged[key] = localBlob[key]!;
    } else {
      delete merged[key];
    }
  }
  return merged;
}

/**
 * After a successful upload, decide which dirty keys are now durably synced
 * and can be cleared — NOT the whole set.
 *
 * A user can mutate another pref *while the POST is in flight*: the setItem
 * patch marks it dirty, but it was never in `postedBlob`. Blanket-clearing
 * the dirty set would drop that tracking, so a subsequent 409 would see an
 * empty dirty set and mergeCloudWithLocalDirty would let the cloud blob
 * clobber the just-made edit — reintroducing the exact data-loss bug the
 * dirty set exists to prevent.
 *
 * A key is "settled" iff the value the server accepted (`postedBlob`) still
 * equals the current local value (`localBlob`). Absence counts as null on
 * both sides, so a synced *removal* settles too. A key changed mid-flight,
 * or dirtied mid-flight and absent from `postedBlob`, fails the equality
 * check and is NOT returned — it stays dirty for the next upload.
 *
 * Pure function — no I/O. Returns the subset of `dirtyKeys` safe to clear.
 */
export function settledDirtyKeys(
  postedBlob: Record<string, string>,
  localBlob: Record<string, string>,
  dirtyKeys: Iterable<string>,
): string[] {
  const settled: string[] = [];
  for (const key of dirtyKeys) {
    const posted = Object.prototype.hasOwnProperty.call(postedBlob, key) ? postedBlob[key]! : null;
    const local = Object.prototype.hasOwnProperty.call(localBlob, key) ? localBlob[key]! : null;
    if (posted === local) settled.push(key);
  }
  return settled;
}

export function parsePersistedDirtyKeys(
  raw: string | null,
  allowedKeys: Iterable<string>,
  expectedUserId: string,
): string[] {
  if (!raw) return [];

  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as { userId?: unknown }).userId !== expectedUserId ||
    !Array.isArray((parsed as { keys?: unknown }).keys)
  ) {
    return [];
  }

  const allowed = new Set(allowedKeys);
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const key of (parsed as { keys: unknown[] }).keys) {
    if (typeof key !== 'string' || !allowed.has(key) || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

/**
 * Retired migration registry.
 *
 * Schema version 2 remains the current cloud-prefs version so older synced
 * blobs do not regress, but the former panel/source-limit recovery
 * migration has been removed along with those limits themselves.
 */
export function buildMigrations(): Record<number, (data: Record<string, unknown>) => Record<string, unknown>> {
  return {};
}

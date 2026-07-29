/**
 * Local sign-in — a Clerk-free auth path for self-hosted installs that don't
 * want a third-party auth provider dependency.
 *
 * Only offered when Clerk itself isn't configured (`isClerkAuthEnabled()` is
 * false — see clerk.ts). This never competes with a real Clerk deployment;
 * it exists purely to give a signed-out state when Clerk was never going to
 * load anyway, instead of `openSignIn()` silently no-oping.
 *
 * Client-side only: this makes `getAuthState()` report a signed-in user so
 * the dashboard's own UI unlocks (Settings > API Keys, etc.). It does NOT by
 * itself authenticate anything server-side — Convex mutations still resolve
 * identity via `ctx.auth.getUserIdentity()`, which is null with no Clerk JWT
 * ever presented. Pairs with `CONVEX_IS_DEV=true` set on your own Convex
 * deployment, which makes `convex/lib/auth.ts`'s `resolveUserId`/
 * `requireUserId` fall back to a fixed `DEV_USER_ID` instead of throwing —
 * see docs/self-hosting-local-auth.md for the one-time setup step.
 */

const STORAGE_KEY = 'wm-local-auth';

/** Mirrors convex/lib/auth.ts's DEV_USER_ID for anyone cross-referencing the
 * two — the client and server resolve this independently (the client never
 * sends this string anywhere), but keeping them recognizably paired avoids
 * "why are there two different local user ids" confusion when debugging. */
export const LOCAL_USER_ID = 'local-user';

const listeners = new Set<() => void>();

export function isLocalSignedIn(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function signInLocally(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Storage unavailable (private browsing, quota) — nothing to persist,
    // but still notify subscribers so the session reflects this tab's state.
  }
  for (const cb of listeners) cb();
}

export function signOutLocally(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // See signInLocally.
  }
  for (const cb of listeners) cb();
}

/** @returns Unsubscribe function. */
export function subscribeLocalAuth(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function getLocalUser() {
  return {
    id: LOCAL_USER_ID,
    name: 'Local User',
    email: '',
    image: null as string | null,
    role: 'free' as const,
  };
}

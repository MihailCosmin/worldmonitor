import { enqueueSentryCall } from '@/bootstrap/sentry-defer';
import { getCurrentClerkUser, isClerkAuthEnabled, openSignIn, scheduleClerkLoad, signOut as clerkSignOut, subscribeClerk } from './clerk';
import { getLocalUser, isLocalSignedIn, signInLocally, signOutLocally, subscribeLocalAuth } from './local-auth';

/** Minimal user profile exposed to UI components. */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  role: 'free' | 'pro';
}

/** Simplified auth session state for UI consumption. */
export interface AuthSession {
  user: AuthUser | null;
  isPending: boolean;
}

let _currentSession: AuthSession = { user: null, isPending: true };

function snapshotSession(): AuthSession {
  const cu = getCurrentClerkUser();
  if (cu) {
    enqueueSentryCall((s) => s.setUser({ id: cu.id }));
    return {
      user: {
        id: cu.id,
        name: cu.name,
        email: cu.email,
        image: cu.image,
        role: cu.plan,
      },
      isPending: false,
    };
  }

  // Clerk has nothing (either not configured, or configured but signed out).
  // Local auth is only ever consulted when Clerk isn't configured at all —
  // it must never shadow a real, properly-configured Clerk deployment's
  // signed-out state.
  if (!isClerkAuthEnabled() && isLocalSignedIn()) {
    enqueueSentryCall((s) => s.setUser(null));
    return { user: getLocalUser(), isPending: false };
  }

  enqueueSentryCall((s) => s.setUser(null));
  return { user: null, isPending: false };
}

/**
 * Initialize auth state. Call once at app startup before UI subscribes.
 *
 * Does NOT await `initClerk()` — the @clerk/clerk-js bundle is ~2.98 MB
 * and 96% unused on first paint, so awaiting it here would block the
 * App.init() chain (panel layout, data fetches, etc.) on a load that
 * isn't needed until the user reaches for auth. Instead, schedule the
 * load via `scheduleClerkLoad()` (idle-callback after first paint).
 *
 * Leaves `_currentSession` at the module-level default
 * `{ user: null, isPending: true }` — calling `snapshotSession()` here
 * would flip `isPending` to `false` while `clerkInstance` is still
 * null, which subscribers cannot distinguish from a settled signed-out
 * session. Cookie-backed signed-in users would then see Sign In / the
 * locked-panel state for up to 4 s (the `requestIdleCallback` timeout)
 * before Clerk hydrates. The pending-callback queue in clerk.ts fires
 * the subscribeAuthState listener as soon as Clerk loads, snapshots
 * the real session, and flips `isPending` to `false`.
 *
 * When Clerk isn't configured at all (`isClerkAuthEnabled()` false),
 * `scheduleClerkLoad()` is a permanent no-op (it bails out before ever
 * touching `loadScheduled`/`initClerk()`), so nothing would ever flip
 * `isPending` to `false` — every consumer would show a loading skeleton
 * forever. Settle immediately in that case instead.
 */
export async function initAuthState(): Promise<void> {
  if (!isClerkAuthEnabled()) {
    _currentSession = snapshotSession();
    return;
  }
  scheduleClerkLoad();
}

/**
 * Subscribe to reactive auth state changes.
 * @returns Unsubscribe function.
 */
export function subscribeAuthState(callback: (state: AuthSession) => void): () => void {
  // Emit current state immediately
  callback(_currentSession);

  const onChange = () => {
    _currentSession = snapshotSession();
    callback(_currentSession);
  };
  const unsubClerk = subscribeClerk(onChange);
  const unsubLocal = subscribeLocalAuth(onChange);
  return () => {
    unsubClerk();
    unsubLocal();
  };
}

/**
 * Synchronous snapshot of current auth state.
 */
export function getAuthState(): AuthSession {
  return _currentSession;
}

/**
 * Sign in — opens Clerk's sign-in modal when Clerk is configured, otherwise
 * establishes a local-only session (see local-auth.ts). This is the one
 * function every "Sign In" button in the app should call instead of
 * `clerk.ts`'s `openSignIn()` directly, so a self-hosted install with no
 * Clerk key gets a working sign-in instead of a silent no-op.
 */
export function signIn(): void {
  if (isClerkAuthEnabled()) {
    openSignIn();
    return;
  }
  signInLocally();
}

/** Symmetric with `signIn()`. */
export async function signOut(): Promise<void> {
  if (isClerkAuthEnabled()) {
    await clerkSignOut();
    return;
  }
  signOutLocally();
}

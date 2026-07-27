import type { AuthSession } from './auth-state';
import { getEntitlementState } from './entitlements';
import type { ClientEntitlementBelief } from './premium-denial';
import { getSecretState } from './runtime-config';
import { isProUser } from './widget-store';

/**
 * Single source of truth for premium access.
 * Covers all access paths: desktop API key, tester keys (wm-pro-key / wm-widget-key),
 * Clerk Pro role, and Convex Dodo entitlement (the latter two via isProUser).
 *
 * The Convex entitlement check is the authoritative signal for paying
 * customers — Clerk `publicMetadata.plan` is NOT written by our webhook
 * pipeline, so a user with a valid Dodo subscription would otherwise show
 * as free here even though isPanelEntitled() already allowed them past
 * the panel-rendering gate. That split caused paying users to see the
 * "Upgrade to Pro" paywall overlay on top of panels they were entitled to,
 * reproducing the 2026-04-17/18 duplicate-subscription incident.
 *
 * isEntitled() is folded into isProUser() (see widget-store.ts) so every
 * call site that checks isProUser — widgets, search, event handlers —
 * agrees with panel gating. That keeps this function a thin union of
 * signals that aren't already covered by isProUser.
 */
export function hasPremiumAccess(authState?: AuthSession): boolean {
  if (getSecretState('WORLDMONITOR_API_KEY').present) return true;
  if (isProUser()) return true;
  if (authState?.user?.role === 'pro') return true;
  return false;
}

/**
 * Snapshot what the CLIENT believes about this account's plan, for
 * `classifyPremiumDenial` (#5608). Deliberately narrower than
 * hasPremiumAccess: the desktop API key and the browser tester keys unlock
 * panels locally but assert nothing about the signed-in Clerk account, so
 * they must not suppress a legitimate upgrade CTA.
 */
export function readClientEntitlementBelief(authState: AuthSession): ClientEntitlementBelief {
  return {
    entitlementTier: getEntitlementState()?.features.tier ?? null,
    authRole: authState.user?.role ?? null,
  };
}

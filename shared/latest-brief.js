export const LATEST_BRIEF_SHARED_USER_ID = 'latest-brief-public';

/**
 * Synthetic compose-only rule for the dashboard's shared Latest Brief
 * fallback. Delivery channels stay empty so the cron never tries to
 * send this edition anywhere; it only exists to keep signed-in
 * readers out of a permanent "composing" state when they have no
 * personal digest rule of their own.
 */
export function createLatestBriefSharedRule() {
  return {
    userId: LATEST_BRIEF_SHARED_USER_ID,
    variant: 'full',
    enabled: true,
    eventTypes: [],
    sensitivity: 'all',
    channels: [],
    aiDigestEnabled: true,
    digestMode: 'daily',
    digestHour: 8,
    digestTimezone: 'UTC',
    lang: 'en',
    updatedAt: 0,
  };
}

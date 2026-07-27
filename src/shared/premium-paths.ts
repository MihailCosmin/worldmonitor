/**
 * Premium RPC paths that require either an API key or a Pro session.
 *
 * Single source of truth consumed by both the server gateway (auth enforcement)
 * and the web client runtime (token injection).
 */
export const PREMIUM_RPC_PATHS = new Set<string>([
  // /api/intelligence/v1/classify-event: LLM-backed classifier. Keep in the
  // premium path set so browser Pro callers attach the Clerk Bearer and
  // anonymous wms_ sessions cannot mint cache-miss LLM spend.
  '/api/intelligence/v1/classify-event',
  // #3734: PRO-gated mutation that enqueues a simulation task. Companion
  // /get-simulation-outcome remains public (existing convention).
  '/api/forecast/v1/trigger-simulation',
  '/api/v2/shipping/route-intelligence',
  '/api/v2/shipping/webhooks',
  // /api/mcp-proxy: Pro-gated outbound MCP proxy (PR #3768, issue #3723).
  // Path-gated here so premiumFetch attaches the Clerk Bearer for normal
  // web Pro users; the server gate in api/mcp-proxy.ts uses isCallerPremium
  // which validates enterprise key, wm_ user key, or Bearer JWT.
  '/api/mcp-proxy',
]);

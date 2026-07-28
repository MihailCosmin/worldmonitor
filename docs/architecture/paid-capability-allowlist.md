# Paid-capability allowlist

This is the complete, exhaustive list of capabilities where World Monitor
still differentiates Free from Pro, as of the D17 stale-gating sweep
(`remove_pro.md`). It exists so a future PR that adds a new upgrade prompt,
tier check, or dashboard-result reduction has to touch this file — making the
addition a deliberate, reviewable decision instead of a silent regrowth of the
gating this project just removed.

**If you are about to add a `premium` / `isProUser` / tier check anywhere and
it is not already represented below, stop and ask whether it should exist.**
If it should, add it here in the same PR. `tests/pro-gated-allowlist.test.mjs`
pins the two enumerable hard-gate registries (`PREMIUM_RPC_PATHS`,
`ENDPOINT_ENTITLEMENTS`) to exactly these entries and fails on any unreviewed
addition or removal. The two standalone checks (`notification-channels.ts`,
`widget-agent.ts`) aren't registry-based and so aren't mechanically pinned —
this doc is their source of truth; keep it in sync by hand.

## Hard gates (401/403 — request is refused outright)

| Capability | Path | Mechanism |
|---|---|---|
| LLM event classification | `/api/intelligence/v1/classify-event` | [`PREMIUM_RPC_PATHS`](../../src/shared/premium-paths.ts) + [`ENDPOINT_ENTITLEMENTS`](../../server/_shared/entitlement-check.ts) tier ≥ 1 |
| On-demand forecast simulation trigger | `/api/forecast/v1/trigger-simulation` | `PREMIUM_RPC_PATHS` + `ENDPOINT_ENTITLEMENTS` tier ≥ 1 (companion read `get-simulation-outcome` is public) |
| Shipping route intelligence | `/api/v2/shipping/route-intelligence` | `PREMIUM_RPC_PATHS` only |
| Shipping disruption-alert webhooks | `/api/v2/shipping/webhooks` | `PREMIUM_RPC_PATHS` only |
| Outbound MCP proxy (connect a third-party MCP server into a dashboard widget) | `/api/mcp-proxy` | `PREMIUM_RPC_PATHS` + `isCallerPremium` in `api/mcp-proxy.ts` |
| Scheduled digest / alert-rule delivery | `/api/notification-channels` (POST) | standalone `entitlements.features.tier < 1` check in `api/notification-channels.ts` — **not** in either registry above, has its own billing-verification-unavailable 503 contract |
| AI Widget Builder (chat-to-widget agent) | `/api/widget-agent` | standalone `session.role === 'pro' \|\| entitlements.features.tier >= 1` check in `api/widget-agent.ts` — **not** in either registry above. A signed-in free (tier 0) user gets a straight `403 Pro subscription required`; there is no free/basic fallback through this path. Any paid plan (Pro tier 1, API Starter/Business tier 2, Enterprise tier 3) passes |

`ENDPOINT_ENTITLEMENTS` and `PREMIUM_RPC_PATHS` overlap on the first two rows
(same two endpoints, checked twice by design — see comments in
`server/_shared/entitlement-check.ts`). Together with the two standalone
checks (`notification-channels.ts`, `widget-agent.ts`) these are the *entire*
set of hard-gated surfaces. Any endpoint not listed above is unrestricted,
regardless of what a comment, doc, or SKILL.md file elsewhere might say —
verify against the registries and the handler itself, not prose.

## Quota/convenience tiers (free access exists; Pro gets more, never a lock)

| Capability | Mechanism |
|---|---|
| MCP access via OAuth/Bearer | Convenience path for Pro users to connect without managing an API key, 50 calls/day — `api/internal/mcp-grant-mint.ts` + `mcp-grant-context.ts`. Manual-API-key-based MCP/REST access (API Starter/Business, tier 2) remains subject only to the hard-gates table above (same `ENDPOINT_ENTITLEMENTS` map MCP and REST both read); there is no free (tier 0) manual-key path at all — see `docs/api-keys.mdx` (manual keys require API Starter or API Business; Dashboard Pro grants OAuth MCP access instead) |
| Market-quote cache freshness | [`PRO_FRESH_CACHE_RPC_PATHS`](../../src/shared/pro-fresh-rpc.ts) (5 market/crypto/commodity/stablecoin/Gulf-quote endpoints) — Pro sessions may get a shorter cache TTL in the browser; free/anon callers keep the same data via the ordinary cache policy. Never a 403 — an authentication surface, not an authorization gate |

Note the asymmetry this creates for agent-facing docs (`public/.well-known/agent-skills/*/SKILL.md`):
every skill's "MUST present an API key" prerequisite is true for everyone
(there is no free key), but a specific operation is only "Pro-gated" beyond
that baseline if it appears in the hard-gates table above. Sanctions
pressure, tariff trends, trade flows, resilience score, and global tenders do
**not** appear there — they need *a* key, not specifically a Pro-tier one —
which is what the D17 sweep corrected across those four `SKILL.md` files.

## Everything else is free

No panel config sets `premium: true` anymore. `isPanelEntitled()`,
`hasPremiumAccess()`, `isProUser()`, `hasTier()` remain in the codebase as
generic entitlement-check infrastructure but are dead-in-practice for panel
gating — kept because the mechanism is legitimate to have, not because
anything currently uses it to lock a panel. If you find a panel, RPC, or
dashboard result that reduces output for free users and it is not in either
table above, it is stale gating left over from the Pro/Premium removal and
should be deleted, not documented.

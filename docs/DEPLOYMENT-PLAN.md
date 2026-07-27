# Deployment Plan — Clerk Auth + Dodo Payments

## Merge Order

**PR #1812 first, then PR #2024.** Dodo billing functions depend on Clerk auth being registered in Convex.

1. Merge `feat/better-auth` → `main` (PR #1812)
2. Rebase `dodo_payments` on updated `main`, resolve conflicts
3. Merge `dodo_payments` → `main` (PR #2024)

---

## Environment Variables

### Clerk Auth (PR #1812)

All values from **Clerk Dashboard → API Keys** ([dashboard.clerk.com](https://dashboard.clerk.com))

| Variable | Set in | Value |
|----------|--------|-------|
| `VITE_CLERK_PUBLISHABLE_KEY` | **Vercel** | Clerk Dashboard → API Keys → Publishable Key (`pk_live_...`) |
| `CLERK_SECRET_KEY` | **Vercel** (secret) | Clerk Dashboard → API Keys → Secret Key (`sk_live_...`) |
| `CLERK_JWT_ISSUER_DOMAIN` | **Vercel** | Your Clerk app domain, e.g. `https://worldmonitor.clerk.accounts.dev` |

#### Clerk Dashboard Setup

1. **JWT Template**: Create a template named **`convex`** with custom claim: `{ "plan": "{{user.public_metadata.plan}}" }`
2. **Pro users**: Set `public_metadata.plan` to `"pro"` on test users to verify Pro-tier entitlements (scheduled digest delivery, MCP access, priority data refresh, Pro Widget Builder) — no dashboard panel is plan-gated anymore
3. **Sign-in methods**: Configure email OTP (or whichever methods you want) under User & Authentication

---

### Dodo Payments (PR #2024)

API key + webhook secret from **Dodo Dashboard** ([app.dodopayments.com](https://app.dodopayments.com))

| Variable | Set in | Value |
|----------|--------|-------|
| `DODO_API_KEY` | **Convex Dashboard** | Dodo → Settings → API Keys |
| `DODO_PAYMENTS_ENVIRONMENT` | **Convex Dashboard** | `test_mode` or `live_mode` |
| `DODO_PAYMENTS_WEBHOOK_SECRET` | **Convex Dashboard** | Dodo → Developers → Webhooks → signing secret |
| `DODO_WEBHOOK_SECRET` | **Convex Dashboard** | Same value as above |
| `VITE_DODO_ENVIRONMENT` | **Vercel** | `test_mode` or `live_mode` (must match server-side) |
| `VITE_CONVEX_URL` | **Vercel** | Convex Dashboard → Settings → Deployment URL (`https://xxx.convex.cloud`) |

#### Dodo Dashboard Setup

1. **Webhook endpoint**: Create a webhook pointing to `https://<convex-deployment>.convex.site/dodo/webhook`
2. **Events to subscribe**: `subscription.active`, `subscription.renewed`, `subscription.on_hold`, `subscription.cancelled`, `subscription.expired`, `subscription.plan_changed`, `payment.succeeded`, `payment.failed`, `refund.succeeded`, `refund.failed`, `dispute.*`
3. **Products**: Ensure product IDs match the seed data in `convex/payments/seedProductPlans.ts` — run `seedProductPlans` mutation after deploy

---

## Deployment Steps

### Step 1 — Merge PR #1812 (Clerk Auth)

```
1. Set Clerk env vars on Vercel (all 3)
2. Create Clerk JWT template named "convex"
3. Merge feat/better-auth → main
4. Deploy to Vercel
5. Verify: Sign in works, bearer tokens appear on the still-gated premium API routes (`PREMIUM_RPC_PATHS`: classify-event, trigger-simulation, route-intelligence, shipping webhooks, mcp-proxy)
```

### Step 2 — Merge PR #2024 (Dodo Payments)

```
1. Set Dodo env vars on Convex Dashboard (4 vars)
2. Set Dodo + Convex env vars on Vercel (2 vars)
3. Rebase dodo_payments on main, resolve conflicts
4. Merge dodo_payments → main
5. Deploy to Vercel + Convex
6. Run seedProductPlans mutation in Convex Dashboard
7. Create webhook endpoint in Dodo Dashboard
8. Verify: Checkout flow → webhook → entitlements granted → panels unlock
```

### Post-Deploy Verification

- [ ] Anonymous user sees no locked panels anywhere in the dashboard
- [ ] Clerk sign-in works (email OTP or configured method)
- [ ] Pro user (`public_metadata.plan: "pro"`) can configure a scheduled digest / alert rule, gets an MCP bearer token, and sees the faster (near-real-time) refresh tier
- [ ] Dodo test checkout (`4242 4242 4242 4242`) creates subscription
- [ ] Webhook fires → subscription + entitlements appear in Convex Dashboard
- [ ] Billing portal opens from Settings
- [ ] Desktop API key flow still works unchanged

---

## Summary

| Where | Variables to set |
|-------|-----------------|
| **Vercel** | `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_JWT_ISSUER_DOMAIN`, `VITE_DODO_ENVIRONMENT`, `VITE_CONVEX_URL` |
| **Convex Dashboard** | `DODO_API_KEY`, `DODO_PAYMENTS_ENVIRONMENT`, `DODO_PAYMENTS_WEBHOOK_SECRET`, `DODO_WEBHOOK_SECRET` |

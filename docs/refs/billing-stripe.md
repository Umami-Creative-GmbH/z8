# Billing & Stripe Reference

## Open This When

- You change subscription, checkout, portal, webhook, or seat-sync logic.
- You modify billing access gates or trial behavior.
- You touch billing tables or Stripe event handling.

## Read First

- `apps/webapp/src/lib/effect/services/billing/stripe.service.ts`
- `apps/webapp/src/lib/effect/services/billing/subscription.service.ts`
- `apps/webapp/src/lib/effect/services/billing/billing-events.service.ts`
- `apps/webapp/src/lib/effect/services/billing/seat-sync.service.ts`
- `apps/webapp/src/db/schema/billing.ts`

## API Surfaces

- `apps/webapp/src/app/api/billing/checkout/route.ts`
- `apps/webapp/src/app/api/billing/portal/route.ts`
- `apps/webapp/src/app/api/billing/webhook/route.ts`

## Guardrails

1. Billing code is gated by `BILLING_ENABLED`.
2. Verify webhook signatures before processing.
3. Keep all billing operations organization-scoped and permission-checked.
4. Preserve webhook idempotency via persisted Stripe event records.

## UI Surface

- `apps/webapp/src/components/billing/billing-page-client.tsx`
- `apps/webapp/src/components/billing/trial-banner.tsx`

Related: `apps/docs/content/docs/guide/admin-guide/billing.mdx`.

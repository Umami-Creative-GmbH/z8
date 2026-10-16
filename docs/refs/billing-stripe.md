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
- `apps/webapp/src/lib/effect/services/billing/billing-configuration.ts`
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
5. A write that can change billing access (subscription existence, status, trial end) runs
   through `withOrganizationBillingMutation` or `withStripeSubscriptionMutation` in
   `billing/billing-configuration.ts`, so it takes exclusive organization configuration
   protection first. Work transactions read billing with `readBillingAccessInTransaction`;
   trial provisioning (`provisionLocalTrial`) never runs inside one. See
   `docs/billing-revalidation-317.md`.
6. Subscription items are found by price, never by position (`billing/seat-items.ts`): the
   full seat item at `STRIPE_PRICE_MONTHLY_ID` / `STRIPE_PRICE_YEARLY_ID`, the kiosk seat
   item at `STRIPE_PRICE_KIOSK_MONTHLY_ID` / `STRIPE_PRICE_KIOSK_YEARLY_ID`.

## Kiosk Seats (#886)

- A billable seat whose user has a reserved kiosk-only email is a kiosk seat; every other
  seat is a full seat. `countBillableSeatsByType` splits the one seat definition, so full +
  kiosk always equals `countBillableSeats`.
- Kiosk seats are on only when BOTH `STRIPE_PRICE_KIOSK_MONTHLY_ID` and
  `STRIPE_PRICE_KIOSK_YEARLY_ID` are set (`kioskSeatsEnabled`). Until then every seat is a
  full seat and billing behaves as before.
- Set the kiosk price IDs on the webapp AND the worker together. Both sync seats (hooks and
  webhooks in the webapp, the hourly reconciliation and departures in the worker); with
  mismatched config they flip subscriptions between split and all-full seats, each flip
  creating prorations.
- Never unset the kiosk price IDs once kiosk items exist: billing would stop seeing the
  kiosk item while Stripe keeps billing it.
- Seat delivery sends both quantities in one `subscriptions.update` under one idempotency
  key and adds the kiosk item, at the kiosk price for the full seat item's interval, the
  first time a kiosk seat appears. Afterwards the item stays, at quantity 0 if need be.
- `subscription.current_seats` and `billing_seat_audit.*_seats` stay seat TOTALS;
  `current_kiosk_seats` and `*_kiosk_seats` hold the kiosk part. `billing_seat_delivery`
  holds the full seat item's quantity in `*_quantity` and the kiosk item's in
  `*_kiosk_quantity`.
- Prices for display live in `apps/webapp/src/lib/billing/seat-prices.ts` (euro cents).
- Turning kiosk seats on: create the two kiosk prices in Stripe, set both IDs on the webapp
  and the worker, then run `pnpm billing:reconcile-kiosk-seats` once
  (`apps/webapp/src/lib/billing/kiosk-seat-reconcile.ts`). It moves existing subscriptions
  to kiosk seats right away instead of waiting for the hourly reconciliation. See "After
  Creating the Kiosk Seat Prices" in `deploy/README.md`.

## UI Surface

- `apps/webapp/src/components/billing/billing-page-client.tsx`
- `apps/webapp/src/components/billing/trial-banner.tsx`

Related: `apps/docs/content/docs/guide/admin-guide/billing.mdx`.

// Billing Services - Stripe integration for SaaS billing
// These services are disabled when BILLING_ENABLED !== "true"

export * from "./billing-enforcement.service";
export * from "./billing-events.service";
export * from "./seat-sync.service";
export * from "./stripe.service";
export * from "./subscription.service";

import { Layer } from "effect";
import { BillingEnforcementServiceLive } from "./billing-enforcement.service";
import { BillingEventsServiceLive } from "./billing-events.service";
import { SeatSyncServiceLive } from "./seat-sync.service";
import { StripeServiceLive } from "./stripe.service";
import { SubscriptionServiceLive } from "./subscription.service";

/**
 * The one billing layer: Stripe, Subscription, BillingEnforcement, SeatSync and
 * BillingEvents, each built once per run. Billing is not part of `AppLayer`; every
 * billing run provides this layer on top of the shared runtime, and callers outside
 * the billing routes import this module lazily.
 */
export const BillingServicesLive = Layer.mergeAll(
	BillingEventsServiceLive,
	BillingEnforcementServiceLive,
).pipe(
	Layer.provideMerge(SeatSyncServiceLive),
	Layer.provideMerge(Layer.mergeAll(StripeServiceLive, SubscriptionServiceLive)),
);

// Billing Services - Stripe integration for SaaS billing
// These services are disabled when BILLING_ENABLED !== "true"

export * from "./stripe.service";
export * from "./subscription.service";
export * from "./seat-sync.service";
export * from "./billing-events.service";
export * from "./billing-enforcement.service";

// Re-export combined layer for convenience
import { Layer } from "effect";
import { StripeServiceLive } from "./stripe.service";
import { SubscriptionServiceLive } from "./subscription.service";
import { SeatSyncServiceLive } from "./seat-sync.service";
import { BillingEventsServiceLive } from "./billing-events.service";
import { BillingEnforcementServiceLive } from "./billing-enforcement.service";

/**
 * Combined layer for all billing services
 * Use this in route handlers and server actions
 */
export const BillingServicesLive = Layer.mergeAll(
	StripeServiceLive,
	SubscriptionServiceLive,
	BillingEnforcementServiceLive,
).pipe(
	Layer.provideMerge(
		SeatSyncServiceLive.pipe(
			Layer.provide(StripeServiceLive),
			Layer.provide(SubscriptionServiceLive),
		),
	),
	Layer.provideMerge(
		BillingEventsServiceLive.pipe(
			Layer.provide(StripeServiceLive),
			Layer.provide(SubscriptionServiceLive),
			Layer.provide(
				SeatSyncServiceLive.pipe(
					Layer.provide(StripeServiceLive),
					Layer.provide(SubscriptionServiceLive),
				),
			),
		),
	),
);

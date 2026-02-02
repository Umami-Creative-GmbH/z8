import { Context, Effect, Layer } from "effect";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { stripeEvent, subscription } from "@/db/schema";
import { StripeService } from "./stripe.service";
import { SubscriptionService } from "./subscription.service";
import { SeatSyncService } from "./seat-sync.service";
import { DatabaseError, StripeError } from "../../errors";
import { createLogger } from "@/lib/logger";

const logger = createLogger("BillingEventsService");

/**
 * BillingEventsService - Processes Stripe webhook events
 * Handles idempotency and state synchronization
 */
export class BillingEventsService extends Context.Tag("BillingEventsService")<
	BillingEventsService,
	{
		/**
		 * Process a Stripe webhook event
		 * Handles idempotency checking and event dispatch
		 */
		readonly processEvent: (event: Stripe.Event) => Effect.Effect<void, DatabaseError | StripeError>;

		/**
		 * Check if an event has already been processed
		 */
		readonly isEventProcessed: (eventId: string) => Effect.Effect<boolean, DatabaseError>;

		/**
		 * Mark an event as processed
		 */
		readonly markEventProcessed: (
			eventId: string,
			error?: string,
		) => Effect.Effect<void, DatabaseError>;
	}
>() {}

export const BillingEventsServiceLive = Layer.effect(
	BillingEventsService,
	Effect.gen(function* () {
		const stripeService = yield* StripeService;
		const subscriptionService = yield* SubscriptionService;
		const seatSyncService = yield* SeatSyncService;

		const handleCheckoutSessionCompleted = (
			session: Stripe.Checkout.Session,
		): Effect.Effect<void, DatabaseError | StripeError> =>
			Effect.gen(function* () {
				const organizationId = session.metadata?.organizationId;

				if (!organizationId || !session.subscription) {
					logger.warn({ sessionId: session.id }, "Missing organization ID in checkout");
					return;
				}

				// Get subscription ID as string
				const subscriptionId = typeof session.subscription === "string"
					? session.subscription
					: session.subscription.id;

				// Fetch subscription details from Stripe
				const stripeSub = yield* stripeService.getSubscription(subscriptionId);

				// Determine billing interval
				const priceInterval = stripeSub.items.data[0]?.price?.recurring?.interval;
				const billingInterval = priceInterval === "year" ? "year" : "month";

				// Get customer ID
				const customerId = typeof session.customer === "string"
					? session.customer
					: session.customer?.id ?? "";

				// Create subscription record
				yield* subscriptionService.create({
					organizationId,
					stripeCustomerId: customerId,
					stripeSubscriptionId: stripeSub.id,
					stripePriceId: stripeSub.items.data[0]?.price?.id ?? "",
					status: stripeSub.status,
					billingInterval,
					trialEnd: stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null,
					currentPeriodStart: stripeSub.items.data[0]?.current_period_start
						? new Date(stripeSub.items.data[0].current_period_start * 1000)
						: new Date(),
					currentPeriodEnd: stripeSub.items.data[0]?.current_period_end
						? new Date(stripeSub.items.data[0].current_period_end * 1000)
						: new Date(),
					seats: stripeSub.items.data[0]?.quantity ?? 1,
				});

				// Sync initial seat count
				yield* seatSyncService.syncSeatsForOrganization(organizationId);

				logger.info(
					{ organizationId, subscriptionId: stripeSub.id, status: stripeSub.status },
					"Subscription created from checkout",
				);
			});

		const handleSubscriptionUpdated = (
			stripeSub: Stripe.Subscription,
		): Effect.Effect<void, DatabaseError> =>
			Effect.gen(function* () {
				const priceInterval = stripeSub.items.data[0]?.price?.recurring?.interval;
				const item = stripeSub.items.data[0];

				yield* subscriptionService.updateFromStripe({
					stripeSubscriptionId: stripeSub.id,
					status: stripeSub.status,
					currentPeriodStart: item?.current_period_start
						? new Date(item.current_period_start * 1000)
						: new Date(),
					currentPeriodEnd: item?.current_period_end
						? new Date(item.current_period_end * 1000)
						: new Date(),
					cancelAt: stripeSub.cancel_at ? new Date(stripeSub.cancel_at * 1000) : null,
					canceledAt: stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000) : null,
					stripePriceId: item?.price?.id,
					billingInterval: priceInterval === "year" ? "year" : "month",
				});

				logger.info(
					{ subscriptionId: stripeSub.id, status: stripeSub.status },
					"Subscription updated",
				);
			});

		const handleSubscriptionDeleted = (
			stripeSub: Stripe.Subscription,
		): Effect.Effect<void, DatabaseError> =>
			Effect.gen(function* () {
				const item = stripeSub.items.data[0];

				yield* subscriptionService.updateFromStripe({
					stripeSubscriptionId: stripeSub.id,
					status: "canceled",
					currentPeriodStart: item?.current_period_start
						? new Date(item.current_period_start * 1000)
						: new Date(),
					currentPeriodEnd: item?.current_period_end
						? new Date(item.current_period_end * 1000)
						: new Date(),
					canceledAt: new Date(),
				});

				logger.info({ subscriptionId: stripeSub.id }, "Subscription deleted/canceled");
			});

		const handleInvoicePaymentSucceeded = (
			invoice: Stripe.Invoice,
		): Effect.Effect<void, DatabaseError> =>
			Effect.gen(function* () {
				// Access subscription from invoice - it can be string, Subscription object, or null
				const invoiceWithSub = invoice as unknown as {
					subscription?: string | { id: string } | null;
				};
				const subscriptionId =
					typeof invoiceWithSub.subscription === "string"
						? invoiceWithSub.subscription
						: invoiceWithSub.subscription?.id;

				if (!subscriptionId) return;

				// Update subscription status to active
				yield* Effect.tryPromise({
					try: async () => {
						await db
							.update(subscription)
							.set({ status: "active" })
							.where(eq(subscription.stripeSubscriptionId, subscriptionId));
					},
					catch: (error) =>
						new DatabaseError({
							message: "Failed to update subscription status",
							operation: "handleInvoicePaymentSucceeded",
							table: "subscription",
							cause: error,
						}),
				});

				logger.info(
					{ subscriptionId, invoiceId: invoice.id },
					"Payment succeeded, subscription activated",
				);
			});

		const handleInvoicePaymentFailed = (
			invoice: Stripe.Invoice,
		): Effect.Effect<void, DatabaseError> =>
			Effect.gen(function* () {
				// Access subscription from invoice - it can be string, Subscription object, or null
				const invoiceWithSub = invoice as unknown as {
					subscription?: string | { id: string } | null;
				};
				const subscriptionId =
					typeof invoiceWithSub.subscription === "string"
						? invoiceWithSub.subscription
						: invoiceWithSub.subscription?.id;

				if (!subscriptionId) return;

				// Mark subscription as past_due
				yield* Effect.tryPromise({
					try: async () => {
						await db
							.update(subscription)
							.set({ status: "past_due" })
							.where(eq(subscription.stripeSubscriptionId, subscriptionId));
					},
					catch: (error) =>
						new DatabaseError({
							message: "Failed to update subscription status",
							operation: "handleInvoicePaymentFailed",
							table: "subscription",
							cause: error,
						}),
				});

				logger.warn(
					{ subscriptionId, invoiceId: invoice.id },
					"Payment failed, subscription marked as past_due",
				);
			});

		const handleCustomerSubscriptionTrialWillEnd = (
			stripeSub: Stripe.Subscription,
		): Effect.Effect<void, DatabaseError> =>
			Effect.gen(function* () {
				// This is for sending notifications - could trigger email here
				logger.info(
					{
						subscriptionId: stripeSub.id,
						trialEnd: stripeSub.trial_end
							? new Date(stripeSub.trial_end * 1000).toISOString()
							: null,
					},
					"Trial will end soon",
				);
				// TODO: Send trial ending email notification
			});

		return BillingEventsService.of({
			isEventProcessed: (eventId) =>
				Effect.tryPromise({
					try: async () => {
						const existing = await db.query.stripeEvent.findFirst({
							where: eq(stripeEvent.stripeEventId, eventId),
						});
						return existing?.processed ?? false;
					},
					catch: (error) =>
						new DatabaseError({
							message: "Failed to check event processed status",
							operation: "isEventProcessed",
							table: "stripe_event",
							cause: error,
						}),
				}),

			markEventProcessed: (eventId, error) =>
				Effect.tryPromise({
					try: async () => {
						await db
							.update(stripeEvent)
							.set({
								processed: true,
								processedAt: new Date(),
								processingError: error,
							})
							.where(eq(stripeEvent.stripeEventId, eventId));
					},
					catch: (dbError) =>
						new DatabaseError({
							message: "Failed to mark event as processed",
							operation: "markEventProcessed",
							table: "stripe_event",
							cause: dbError,
						}),
				}),

			processEvent: (event) =>
				Effect.gen(function* () {
					// Check idempotency
					const isProcessed = yield* Effect.tryPromise({
						try: async () => {
							const existing = await db.query.stripeEvent.findFirst({
								where: eq(stripeEvent.stripeEventId, event.id),
							});
							return existing?.processed ?? false;
						},
						catch: (error) =>
							new DatabaseError({
								message: "Failed to check event idempotency",
								operation: "processEvent",
								table: "stripe_event",
								cause: error,
							}),
					});

					if (isProcessed) {
						logger.info({ eventId: event.id }, "Event already processed, skipping");
						return;
					}

					// Get organization ID from event if possible
					let organizationId: string | undefined;
					if (event.data.object && "metadata" in event.data.object) {
						const metadata = event.data.object.metadata as Record<string, string> | undefined;
						organizationId = metadata?.organizationId;
					}

					// Store event for idempotency
					yield* Effect.tryPromise({
						try: async () => {
							await db
								.insert(stripeEvent)
								.values({
									stripeEventId: event.id,
									type: event.type,
									organizationId,
									data: event.data as unknown as Record<string, unknown>,
									processed: false,
								})
								.onConflictDoNothing();
						},
						catch: (error) =>
							new DatabaseError({
								message: "Failed to store event",
								operation: "processEvent",
								table: "stripe_event",
								cause: error,
							}),
					});

					// Process based on event type
					try {
						switch (event.type) {
							case "checkout.session.completed":
								yield* handleCheckoutSessionCompleted(
									event.data.object as Stripe.Checkout.Session,
								);
								break;

							case "customer.subscription.created":
							case "customer.subscription.updated":
								yield* handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
								break;

							case "customer.subscription.deleted":
								yield* handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
								break;

							case "invoice.payment_succeeded":
								yield* handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
								break;

							case "invoice.payment_failed":
								yield* handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
								break;

							case "customer.subscription.trial_will_end":
								yield* handleCustomerSubscriptionTrialWillEnd(
									event.data.object as Stripe.Subscription,
								);
								break;

							default:
								logger.debug({ eventType: event.type }, "Unhandled event type");
						}

						// Mark as processed
						yield* Effect.tryPromise({
							try: async () => {
								await db
									.update(stripeEvent)
									.set({ processed: true, processedAt: new Date() })
									.where(eq(stripeEvent.stripeEventId, event.id));
							},
							catch: (error) =>
								new DatabaseError({
									message: "Failed to mark event processed",
									operation: "processEvent",
									table: "stripe_event",
									cause: error,
								}),
						});
					} catch (error) {
						// Store error but don't fail
						yield* Effect.tryPromise({
							try: async () => {
								await db
									.update(stripeEvent)
									.set({ processingError: String(error) })
									.where(eq(stripeEvent.stripeEventId, event.id));
							},
							catch: () =>
								new DatabaseError({
									message: "Failed to store event error",
									operation: "processEvent",
									table: "stripe_event",
									cause: error,
								}),
						});

						logger.error({ error, eventType: event.type, eventId: event.id }, "Event processing failed");
						throw error;
					}
				}),
		});
	}),
);

import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DateTime } from "luxon";
import type Stripe from "stripe";
import { db } from "@/db";
import { stripeEvent, subscription } from "@/db/schema";
import { env } from "@/env";
import { sendBillingSystemEmail } from "@/lib/billing/billing-system-email";
import { createLogger } from "@/lib/logger";
import { DatabaseError, type StripeError } from "../../errors";
import { SeatSyncService } from "./seat-sync.service";
import { StripeService } from "./stripe.service";
import { SubscriptionService } from "./subscription.service";

const logger = createLogger("BillingEventsService");
const DEFAULT_APP_URL = "https://app.z8-time.app";

const getBillingUrl = () => {
	const appUrl = env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || DEFAULT_APP_URL;
	return `${appUrl}/settings/billing`;
};

const formatStripeTimestamp = (timestamp?: number | null) =>
	timestamp ? DateTime.fromSeconds(timestamp, { zone: "utc" }).toFormat("LLLL d, yyyy") : undefined;

const formatStripeAmount = (amount?: number | null, currency?: string | null) => {
	if (amount == null) return undefined;

	try {
		return new Intl.NumberFormat("en", {
			style: "currency",
			currency: (currency ?? "eur").toUpperCase(),
		}).format(amount / 100);
	} catch {
		return `${(currency ?? "eur").toUpperCase()} ${(amount / 100).toFixed(2)}`;
	}
};

const getCustomerId = (
	customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined,
) => (typeof customer === "string" ? customer : customer?.id);

const getCustomerEmailFromObject = (
	customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined,
) => (typeof customer === "object" && customer && "email" in customer ? customer.email : undefined);

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
		readonly processEvent: (
			event: Stripe.Event,
		) => Effect.Effect<void, DatabaseError | StripeError>;

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

		const resolveCustomerEmail = (
			customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined,
			fallbackEmail?: string | null,
		): Effect.Effect<string | undefined, never> => {
			const customerEmail = getCustomerEmailFromObject(customer) ?? fallbackEmail ?? undefined;
			if (customerEmail) return Effect.succeed(customerEmail);

			const customerId = getCustomerId(customer);
			if (!customerId) return Effect.succeed(undefined);

			return stripeService.getCustomer(customerId).pipe(
				Effect.match({
					onFailure: (error) => {
						logger.warn({ customerId, error }, "Failed to resolve Stripe customer email");
						return undefined;
					},
					onSuccess: (stripeCustomer) => stripeCustomer.email ?? undefined,
				}),
			);
		};

		const sendBillingEmail = (params: Parameters<typeof sendBillingSystemEmail>[0]) =>
			Effect.tryPromise({
				try: () => sendBillingSystemEmail(params),
				catch: (error) => error,
			}).pipe(
				Effect.match({
					onFailure: (error) => {
						logger.warn(
							{
								templateKey: params.templateKey,
								error: error instanceof Error ? error.name : typeof error,
							},
							"Billing system email failed outside sender guard",
						);
					},
					onSuccess: () => undefined,
				}),
			);

		const baseBillingEmailData = (customerEmail?: string) => {
			const billingUrl = getBillingUrl();
			return {
				organizationName: "your organization",
				customerEmail,
				billingUrl,
				billingPortalUrl: billingUrl,
				planName: "Z8",
			};
		};

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
				const subscriptionId =
					typeof session.subscription === "string" ? session.subscription : session.subscription.id;

				// Fetch subscription details from Stripe
				const stripeSub = yield* stripeService.getSubscription(subscriptionId);

				// Determine billing interval
				const priceInterval = stripeSub.items.data[0]?.price?.recurring?.interval;
				const billingInterval = priceInterval === "year" ? "year" : "month";

				// Get customer ID
				const customerId =
					typeof session.customer === "string" ? session.customer : (session.customer?.id ?? "");

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
					{
						organizationId,
						subscriptionId: stripeSub.id,
						status: stripeSub.status,
					},
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
				const customerEmail = yield* resolveCustomerEmail(stripeSub.customer);
				const trialEndsAt = formatStripeTimestamp(stripeSub.trial_end);
				const daysRemaining = stripeSub.trial_end
					? Math.max(0, Math.ceil((stripeSub.trial_end - DateTime.utc().toSeconds()) / 86_400))
					: undefined;

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
				yield* sendBillingEmail({
					templateKey: "billing-trial-ending",
					to: customerEmail,
					data: {
						...baseBillingEmailData(customerEmail),
						daysRemaining,
						trialEnd: trialEndsAt,
						trialEndsAt,
					},
				});
			});

		const handleCustomerSubscriptionPaused = (
			stripeSub: Stripe.Subscription,
		): Effect.Effect<void, DatabaseError> =>
			Effect.gen(function* () {
				const customerEmail = yield* resolveCustomerEmail(stripeSub.customer);

				yield* Effect.tryPromise({
					try: async () => {
						await db
							.update(subscription)
							.set({
								status: "paused",
								metadata: {
									pausedAt: new Date().toISOString(),
									pauseReason: stripeSub.pause_collection?.behavior ?? "unknown",
								},
							})
							.where(eq(subscription.stripeSubscriptionId, stripeSub.id));
					},
					catch: (error) =>
						new DatabaseError({
							message: "Failed to update subscription to paused",
							operation: "handleCustomerSubscriptionPaused",
							table: "subscription",
							cause: error,
						}),
				});

				logger.info(
					{
						subscriptionId: stripeSub.id,
						pauseBehavior: stripeSub.pause_collection?.behavior,
						resumesAt: stripeSub.pause_collection?.resumes_at
							? new Date(stripeSub.pause_collection.resumes_at * 1000).toISOString()
							: null,
					},
					"Subscription paused",
				);
				yield* sendBillingEmail({
					templateKey: "billing-subscription-paused",
					to: customerEmail,
					data: {
						...baseBillingEmailData(customerEmail),
						subscriptionStatus: "paused",
					},
				});
			});

		const handleCustomerSubscriptionResumed = (
			stripeSub: Stripe.Subscription,
		): Effect.Effect<void, DatabaseError> =>
			Effect.gen(function* () {
				const item = stripeSub.items.data[0];
				const customerEmail = yield* resolveCustomerEmail(stripeSub.customer);

				yield* Effect.tryPromise({
					try: async () => {
						await db
							.update(subscription)
							.set({
								status: stripeSub.status, // Will be 'active' or 'trialing'
								currentPeriodStart: item?.current_period_start
									? new Date(item.current_period_start * 1000)
									: new Date(),
								currentPeriodEnd: item?.current_period_end
									? new Date(item.current_period_end * 1000)
									: new Date(),
								metadata: {
									resumedAt: new Date().toISOString(),
								},
							})
							.where(eq(subscription.stripeSubscriptionId, stripeSub.id));
					},
					catch: (error) =>
						new DatabaseError({
							message: "Failed to update subscription to resumed",
							operation: "handleCustomerSubscriptionResumed",
							table: "subscription",
							cause: error,
						}),
				});

				logger.info(
					{ subscriptionId: stripeSub.id, status: stripeSub.status },
					"Subscription resumed",
				);
				yield* sendBillingEmail({
					templateKey: "billing-subscription-resumed",
					to: customerEmail,
					data: {
						...baseBillingEmailData(customerEmail),
						resumeDate: DateTime.utc().toFormat("LLLL d, yyyy"),
					},
				});
			});

		const handleInvoiceFinalized = (invoice: Stripe.Invoice): Effect.Effect<void, DatabaseError> =>
			Effect.gen(function* () {
				const customerEmail = yield* resolveCustomerEmail(invoice.customer, invoice.customer_email);

				// Get subscription ID from invoice
				const invoiceWithSub = invoice as unknown as {
					subscription?: string | { id: string } | null;
				};
				const subscriptionId =
					typeof invoiceWithSub.subscription === "string"
						? invoiceWithSub.subscription
						: invoiceWithSub.subscription?.id;

				if (!subscriptionId) return;

				// Store invoice details in subscription metadata for reference
				yield* Effect.tryPromise({
					try: async () => {
						const existing = await db.query.subscription.findFirst({
							where: eq(subscription.stripeSubscriptionId, subscriptionId),
						});

						if (existing) {
							const existingMetadata = (existing.metadata ?? {}) as Record<string, unknown>;
							await db
								.update(subscription)
								.set({
									metadata: {
										...existingMetadata,
										lastInvoice: {
											id: invoice.id,
											number: invoice.number,
											amountDue: invoice.amount_due,
											amountPaid: invoice.amount_paid,
											currency: invoice.currency,
											status: invoice.status,
											hostedInvoiceUrl: invoice.hosted_invoice_url,
											invoicePdf: invoice.invoice_pdf,
											finalizedAt: new Date().toISOString(),
										},
									},
								})
								.where(eq(subscription.stripeSubscriptionId, subscriptionId));
						}
					},
					catch: (error) =>
						new DatabaseError({
							message: "Failed to store invoice details",
							operation: "handleInvoiceFinalized",
							table: "subscription",
							cause: error,
						}),
				});

				logger.info(
					{
						invoiceId: invoice.id,
						invoiceNumber: invoice.number,
						subscriptionId,
						amountDue: invoice.amount_due,
						currency: invoice.currency,
						status: invoice.status,
					},
					"Invoice finalized",
				);
				yield* sendBillingEmail({
					templateKey: "billing-invoice-ready",
					to: customerEmail,
					data: {
						...baseBillingEmailData(customerEmail),
						invoiceNumber: invoice.number ?? invoice.id,
						invoiceAmount: formatStripeAmount(invoice.amount_due, invoice.currency),
						amountDue: formatStripeAmount(invoice.amount_due, invoice.currency),
						dueDate: formatStripeTimestamp(invoice.due_date) ?? "not set",
						invoiceUrl: invoice.hosted_invoice_url,
						invoicePdfUrl: invoice.invoice_pdf,
					},
				});
			});

		const handlePaymentIntentFailed = (
			paymentIntent: Stripe.PaymentIntent,
		): Effect.Effect<void, DatabaseError> =>
			Effect.gen(function* () {
				// Extract failure details
				const lastError = paymentIntent.last_payment_error;
				const failureCode = lastError?.code ?? "unknown";
				const failureMessage = lastError?.message ?? "Payment failed";
				const declineCode = lastError?.decline_code;

				// Try to find subscription from metadata or invoice
				const subscriptionId = paymentIntent.metadata?.subscriptionId;
				// invoice can be string, Invoice object, or null (expandable field)
				const paymentIntentWithInvoice = paymentIntent as unknown as {
					invoice?: string | { id: string } | null;
				};
				const invoiceId =
					typeof paymentIntentWithInvoice.invoice === "string"
						? paymentIntentWithInvoice.invoice
						: paymentIntentWithInvoice.invoice?.id;
				const customerEmail = yield* resolveCustomerEmail(
					paymentIntent.customer,
					paymentIntent.receipt_email,
				);

				// Log detailed failure info for debugging and customer support
				logger.warn(
					{
						paymentIntentId: paymentIntent.id,
						subscriptionId,
						invoiceId,
						failureCode,
						failureMessage,
						declineCode,
						paymentMethodType: lastError?.payment_method?.type,
						cardBrand: lastError?.payment_method?.card?.brand,
						cardLast4: lastError?.payment_method?.card?.last4,
						amount: paymentIntent.amount,
						currency: paymentIntent.currency,
					},
					"Payment intent failed",
				);

				// If we can identify the subscription, store failure details
				if (subscriptionId) {
					yield* Effect.tryPromise({
						try: async () => {
							const existing = await db.query.subscription.findFirst({
								where: eq(subscription.stripeSubscriptionId, subscriptionId),
							});

							if (existing) {
								const existingMetadata = (existing.metadata ?? {}) as Record<string, unknown>;
								await db
									.update(subscription)
									.set({
										metadata: {
											...existingMetadata,
											lastPaymentFailure: {
												paymentIntentId: paymentIntent.id,
												failureCode,
												failureMessage,
												declineCode,
												failedAt: new Date().toISOString(),
												amount: paymentIntent.amount,
												currency: paymentIntent.currency,
											},
										},
									})
									.where(eq(subscription.stripeSubscriptionId, subscriptionId));
							}
						},
						catch: (error) =>
							new DatabaseError({
								message: "Failed to store payment failure details",
								operation: "handlePaymentIntentFailed",
								table: "subscription",
								cause: error,
							}),
					});
				}

				yield* sendBillingEmail({
					templateKey: "billing-payment-failed",
					to: customerEmail,
					data: {
						...baseBillingEmailData(customerEmail),
						invoiceAmount: formatStripeAmount(paymentIntent.amount, paymentIntent.currency),
						amountDue: formatStripeAmount(paymentIntent.amount, paymentIntent.currency),
						failureReason: failureMessage,
						paymentRetryDate: "soon",
						invoiceUrl: invoiceId ? getBillingUrl() : undefined,
					},
				});
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
								yield* handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
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

							case "customer.subscription.paused":
								yield* handleCustomerSubscriptionPaused(event.data.object as Stripe.Subscription);
								break;

							case "customer.subscription.resumed":
								yield* handleCustomerSubscriptionResumed(event.data.object as Stripe.Subscription);
								break;

							case "invoice.finalized":
								yield* handleInvoiceFinalized(event.data.object as Stripe.Invoice);
								break;

							case "payment_intent.payment_failed":
								yield* handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
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

						logger.error(
							{ error, eventType: event.type, eventId: event.id },
							"Event processing failed",
						);
						throw error;
					}
				}),
		});
	}),
);

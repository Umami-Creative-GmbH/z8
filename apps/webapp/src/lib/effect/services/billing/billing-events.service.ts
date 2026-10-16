import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import type Stripe from "stripe";
import { organization } from "@/db/auth-schema";
import { stripeEvent, subscription } from "@/db/schema";
import { env } from "@/env";
import { sendBillingSystemEmail } from "@/lib/billing/billing-system-email";
import {
	type Instant,
	instantFromDate,
	plainDateAt,
	systemClock,
} from "@/lib/datetime/temporal-core";
import type { DatabaseError, StripeError } from "@/lib/effect/errors";
import { withStripeSubscriptionMutation } from "@/lib/effect/services/billing/billing-configuration";
import { findFullSeatItem, findKioskSeatItem } from "@/lib/effect/services/billing/seat-items";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import {
	notificationParam,
	type TypedNotificationParam,
} from "@/lib/notifications/notification-params";
import { resolveOrganizationTimezone } from "@/lib/timezone/resolve-timezone";
import { SeatSyncService } from "./seat-sync.service";
import { StripeService } from "./stripe.service";
import { SubscriptionService } from "./subscription.service";

const logger = createLogger("BillingEventsService");
const DEFAULT_APP_URL = "https://app.z8-time.app";

const getBillingUrl = () => {
	const appUrl = env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || DEFAULT_APP_URL;
	return `${appUrl}/settings/billing`;
};

/** The organization a billing email is about: its name and calendar. */
interface BillingOrganization {
	id: string;
	name: string;
	timezone: string;
}

/**
 * The calendar day of `instant` in the organization's timezone (UTC when the
 * organization is unknown), formatted in the email's language by the sender.
 */
const billingDateParam = (
	instant: Instant | undefined,
	billingOrganization: BillingOrganization | undefined,
): TypedNotificationParam | undefined =>
	instant
		? notificationParam.plainDate(plainDateAt(instant, billingOrganization?.timezone ?? "UTC"))
		: undefined;

/** A Stripe timestamp (seconds) as an instant. */
const stripeInstant = (timestamp?: number | null): Instant | undefined =>
	timestamp ? instantFromDate(new Date(timestamp * 1000)) : undefined;

/** A Stripe amount (minor units) with its currency, formatted in the email's language. */
const stripeAmountParam = (
	amount?: number | null,
	currency?: string | null,
): TypedNotificationParam | undefined =>
	amount == null
		? undefined
		: notificationParam.money((amount / 100).toFixed(2), (currency ?? "eur").toUpperCase());

const getCustomerId = (
	customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined,
) => (typeof customer === "string" ? customer : customer?.id);

const getCustomerEmailFromObject = (
	customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined,
) => (typeof customer === "object" && customer && "email" in customer ? customer.email : undefined);

/**
 * Legacy: invoices rendered in webhook API versions before 2025-03-31.basil carry a
 * top-level `subscription`, which the current types no longer declare. Remove once every
 * webhook endpoint is on basil or later.
 */
const getLegacyInvoiceSubscriptionId = (invoice: Stripe.Invoice): string | undefined => {
	if (!("subscription" in invoice)) return undefined;
	const legacy = invoice.subscription;
	if (typeof legacy === "string") return legacy;
	return legacy && typeof legacy === "object" && "id" in legacy && typeof legacy.id === "string"
		? legacy.id
		: undefined;
};

/** The subscription an invoice bills, or undefined for invoices outside a subscription. */
const getInvoiceSubscriptionId = (invoice: Stripe.Invoice): string | undefined => {
	const subscription = invoice.parent?.subscription_details?.subscription;
	if (subscription) return typeof subscription === "string" ? subscription : subscription.id;
	return getLegacyInvoiceSubscriptionId(invoice);
};

/**
 * BillingEventsService - Processes Stripe webhook events
 * Handles idempotency and state synchronization
 */
export class BillingEventsService extends Context.Service<
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
>()("BillingEventsService") {}

export const BillingEventsServiceLive = Layer.effect(
	BillingEventsService,
	Effect.gen(function* () {
		const stripeService = yield* StripeService;
		const subscriptionService = yield* SubscriptionService;
		const seatSyncService = yield* SeatSyncService;
		const dbService = yield* DatabaseService;

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

		/** Best-effort: a missing invoice must not fail webhook processing. */
		const findPaymentIntentInvoice = (
			paymentIntentId: string,
		): Effect.Effect<Stripe.Invoice | null, never> =>
			stripeService.getInvoiceForPaymentIntent(paymentIntentId).pipe(
				Effect.match({
					onFailure: (error) => ({ invoice: null, error }),
					onSuccess: (invoice) => ({ invoice, error: undefined }),
				}),
				Effect.map(({ invoice, error }) => {
					if (!invoice) {
						logger.warn(
							{ paymentIntentId, error },
							"No invoice resolved for failed payment intent",
						);
					}
					return invoice;
				}),
			);

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

		/**
		 * The organization billed, found through its `subscription` row (or the Stripe
		 * object's `organizationId` metadata). Best-effort: without it the email goes out
		 * in English with fallback copy, and the webhook still succeeds.
		 */
		const resolveBillingOrganization = (lookup: {
			stripeSubscriptionId?: string;
			metadata?: Stripe.Metadata | null;
		}): Effect.Effect<BillingOrganization | undefined, never> =>
			dbService
				.query("billingEvents.resolveBillingOrganization", async () => {
					const subscriptionRow = lookup.stripeSubscriptionId
						? await dbService.db.query.subscription.findFirst({
								where: eq(subscription.stripeSubscriptionId, lookup.stripeSubscriptionId),
								columns: { organizationId: true },
							})
						: undefined;
					const organizationId =
						subscriptionRow?.organizationId ?? lookup.metadata?.organizationId ?? undefined;
					if (!organizationId) return undefined;

					const row = await dbService.db.query.organization.findFirst({
						where: eq(organization.id, organizationId),
						columns: { id: true, name: true, timezone: true },
					});
					if (!row) return undefined;

					return {
						id: row.id,
						name: row.name,
						timezone: resolveOrganizationTimezone(row.timezone).timezone,
					};
				})
				.pipe(
					Effect.match({
						onFailure: (error) => {
							logger.warn(
								{ stripeSubscriptionId: lookup.stripeSubscriptionId, error },
								"Failed to resolve the organization of a billing email",
							);
							return undefined;
						},
						onSuccess: (billingOrganization) => billingOrganization,
					}),
				);

		const baseBillingEmailData = (
			customerEmail: string | undefined,
			billingOrganization: BillingOrganization | undefined,
		) => {
			const billingUrl = getBillingUrl();
			return {
				organizationName: billingOrganization?.name,
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

				// Interval, period, price and seats come from the full seat item
				const item = findFullSeatItem(stripeSub, stripeService.config);
				const priceInterval = item?.price?.recurring?.interval;
				const billingInterval = priceInterval === "year" ? "year" : "month";
				// The kiosk seat item, found by kiosk price, holds the kiosk seats (#886)
				const kioskSeats = findKioskSeatItem(stripeSub, stripeService.config)?.quantity ?? 0;

				// Get customer ID
				const customerId =
					typeof session.customer === "string" ? session.customer : (session.customer?.id ?? "");

				// Create subscription record
				yield* subscriptionService.create({
					organizationId,
					stripeCustomerId: customerId,
					stripeSubscriptionId: stripeSub.id,
					stripePriceId: item?.price?.id ?? "",
					status: stripeSub.status,
					billingInterval,
					trialEnd: stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null,
					currentPeriodStart: item?.current_period_start
						? new Date(item.current_period_start * 1000)
						: new Date(),
					currentPeriodEnd: item?.current_period_end
						? new Date(item.current_period_end * 1000)
						: new Date(),
					seats: (item?.quantity ?? 1) + kioskSeats,
					kioskSeats,
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
				const item = findFullSeatItem(stripeSub, stripeService.config);
				const priceInterval = item?.price?.recurring?.interval;

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
				const item = findFullSeatItem(stripeSub, stripeService.config);

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
				const subscriptionId = getInvoiceSubscriptionId(invoice);

				if (!subscriptionId) return;

				// Update subscription status to active
				yield* dbService.query("billingEvents.markInvoicePaid", async () => {
					await withStripeSubscriptionMutation(
						dbService.db,
						subscriptionId,
						async (transaction, scope) => {
							await transaction.update(subscription).set({ status: "active" }).where(scope);
						},
					);
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
				const subscriptionId = getInvoiceSubscriptionId(invoice);

				if (!subscriptionId) return;

				// Mark subscription as past_due
				yield* dbService.query("billingEvents.markInvoicePaymentFailed", async () => {
					await withStripeSubscriptionMutation(
						dbService.db,
						subscriptionId,
						async (transaction, scope) => {
							await transaction.update(subscription).set({ status: "past_due" }).where(scope);
						},
					);
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
				const billingOrganization = yield* resolveBillingOrganization({
					stripeSubscriptionId: stripeSub.id,
					metadata: stripeSub.metadata,
				});
				const trialEndsAt = billingDateParam(
					stripeInstant(stripeSub.trial_end),
					billingOrganization,
				);
				const daysRemaining = stripeSub.trial_end
					? Math.max(
							0,
							Math.ceil(
								(stripeSub.trial_end - systemClock.nowInstant().epochMilliseconds / 1000) / 86_400,
							),
						)
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
					organizationId: billingOrganization?.id,
					data: {
						...baseBillingEmailData(customerEmail, billingOrganization),
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

				yield* dbService.query("billingEvents.pauseSubscription", async () => {
					await withStripeSubscriptionMutation(
						dbService.db,
						stripeSub.id,
						async (transaction, scope) => {
							await transaction
								.update(subscription)
								.set({
									status: "paused",
									metadata: {
										pausedAt: new Date().toISOString(),
										pauseReason: stripeSub.pause_collection?.behavior ?? "unknown",
									},
								})
								.where(scope);
						},
					);
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
				const billingOrganization = yield* resolveBillingOrganization({
					stripeSubscriptionId: stripeSub.id,
					metadata: stripeSub.metadata,
				});
				yield* sendBillingEmail({
					templateKey: "billing-subscription-paused",
					to: customerEmail,
					organizationId: billingOrganization?.id,
					data: {
						...baseBillingEmailData(customerEmail, billingOrganization),
						subscriptionStatus: "paused",
					},
				});
			});

		const handleCustomerSubscriptionResumed = (
			stripeSub: Stripe.Subscription,
		): Effect.Effect<void, DatabaseError> =>
			Effect.gen(function* () {
				const item = findFullSeatItem(stripeSub, stripeService.config);
				const customerEmail = yield* resolveCustomerEmail(stripeSub.customer);

				yield* dbService.query("billingEvents.resumeSubscription", async () => {
					await withStripeSubscriptionMutation(
						dbService.db,
						stripeSub.id,
						async (transaction, scope) => {
							await transaction
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
								.where(scope);
						},
					);
				});

				logger.info(
					{ subscriptionId: stripeSub.id, status: stripeSub.status },
					"Subscription resumed",
				);
				const billingOrganization = yield* resolveBillingOrganization({
					stripeSubscriptionId: stripeSub.id,
					metadata: stripeSub.metadata,
				});
				yield* sendBillingEmail({
					templateKey: "billing-subscription-resumed",
					to: customerEmail,
					organizationId: billingOrganization?.id,
					data: {
						...baseBillingEmailData(customerEmail, billingOrganization),
						resumeDate: billingDateParam(systemClock.nowInstant(), billingOrganization),
					},
				});
			});

		const handleInvoiceFinalized = (invoice: Stripe.Invoice): Effect.Effect<void, DatabaseError> =>
			Effect.gen(function* () {
				const customerEmail = yield* resolveCustomerEmail(invoice.customer, invoice.customer_email);

				const subscriptionId = getInvoiceSubscriptionId(invoice);

				if (!subscriptionId) return;

				// Store invoice details in subscription metadata for reference
				yield* dbService.query("billingEvents.storeInvoiceDetails", async () => {
					const existing = await dbService.db.query.subscription.findFirst({
						where: eq(subscription.stripeSubscriptionId, subscriptionId),
					});

					if (existing) {
						const existingMetadata = (existing.metadata ?? {}) as Record<string, unknown>;
						await dbService.db
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
				const billingOrganization = yield* resolveBillingOrganization({
					stripeSubscriptionId: subscriptionId,
					metadata: invoice.metadata,
				});
				yield* sendBillingEmail({
					templateKey: "billing-invoice-ready",
					to: customerEmail,
					organizationId: billingOrganization?.id,
					data: {
						...baseBillingEmailData(customerEmail, billingOrganization),
						invoiceNumber: invoice.number ?? invoice.id,
						invoiceAmount: stripeAmountParam(invoice.amount_due, invoice.currency),
						amountDue: stripeAmountParam(invoice.amount_due, invoice.currency),
						// Unset: the sender writes "not set" in the email's language.
						dueDate: billingDateParam(stripeInstant(invoice.due_date), billingOrganization),
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

				const invoice = yield* findPaymentIntentInvoice(paymentIntent.id);
				const invoiceId = invoice?.id;
				// Try to find subscription from metadata or invoice
				const subscriptionId =
					paymentIntent.metadata?.subscriptionId ||
					(invoice ? getInvoiceSubscriptionId(invoice) : undefined);
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
					yield* dbService.query("billingEvents.storePaymentFailure", async () => {
						const existing = await dbService.db.query.subscription.findFirst({
							where: eq(subscription.stripeSubscriptionId, subscriptionId),
						});

						if (existing) {
							const existingMetadata = (existing.metadata ?? {}) as Record<string, unknown>;
							await dbService.db
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
					});
				}

				const billingOrganization = yield* resolveBillingOrganization({
					stripeSubscriptionId: subscriptionId,
					metadata: paymentIntent.metadata,
				});
				yield* sendBillingEmail({
					templateKey: "billing-payment-failed",
					to: customerEmail,
					organizationId: billingOrganization?.id,
					data: {
						...baseBillingEmailData(customerEmail, billingOrganization),
						invoiceAmount: stripeAmountParam(paymentIntent.amount, paymentIntent.currency),
						amountDue: stripeAmountParam(paymentIntent.amount, paymentIntent.currency),
						failureReason: failureMessage,
						// Unset without a scheduled retry: the sender writes "soon" in the email's language.
						paymentRetryDate: billingDateParam(
							stripeInstant(invoice?.next_payment_attempt),
							billingOrganization,
						),
						invoiceUrl: invoiceId ? getBillingUrl() : undefined,
					},
				});
			});

		return BillingEventsService.of({
			isEventProcessed: (eventId) =>
				dbService.query("billingEvents.isEventProcessed", async () => {
					const existing = await dbService.db.query.stripeEvent.findFirst({
						where: eq(stripeEvent.stripeEventId, eventId),
					});
					return existing?.processed ?? false;
				}),

			markEventProcessed: (eventId, error) =>
				dbService.query("billingEvents.markEventProcessed", async () => {
					await dbService.db
						.update(stripeEvent)
						.set({
							processed: true,
							processedAt: new Date(),
							processingError: error,
						})
						.where(eq(stripeEvent.stripeEventId, eventId));
				}),

			processEvent: (event) =>
				Effect.gen(function* () {
					// Check idempotency
					const isProcessed = yield* dbService.query(
						"billingEvents.checkEventIdempotency",
						async () => {
							const existing = await dbService.db.query.stripeEvent.findFirst({
								where: eq(stripeEvent.stripeEventId, event.id),
							});
							return existing?.processed ?? false;
						},
					);

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
					yield* dbService.query("billingEvents.storeEvent", async () => {
						await dbService.db
							.insert(stripeEvent)
							.values({
								stripeEventId: event.id,
								type: event.type,
								organizationId,
								data: event.data as unknown as Record<string, unknown>,
								processed: false,
							})
							.onConflictDoNothing();
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
						yield* dbService.query("billingEvents.markProcessEventProcessed", async () => {
							await dbService.db
								.update(stripeEvent)
								.set({ processed: true, processedAt: new Date() })
								.where(eq(stripeEvent.stripeEventId, event.id));
						});
					} catch (error) {
						// Store error but don't fail
						yield* dbService.query("billingEvents.storeEventError", async () => {
							await dbService.db
								.update(stripeEvent)
								.set({ processingError: String(error) })
								.where(eq(stripeEvent.stripeEventId, event.id));
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

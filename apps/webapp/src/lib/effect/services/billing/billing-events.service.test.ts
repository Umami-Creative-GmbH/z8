import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendBillingSystemEmail } from "@/lib/billing/billing-system-email";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { StripeError } from "@/lib/effect/errors";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import { notificationParam } from "@/lib/notifications/notification-params";
import { BillingEventsService, BillingEventsServiceLive } from "./billing-events.service";
import { SeatSyncService } from "./seat-sync.service";
import { StripeService } from "./stripe.service";
import {
	type CreateSubscriptionParams,
	SubscriptionService,
	type UpdateSubscriptionFromStripeParams,
} from "./subscription.service";

const {
	stripeEventFindFirst,
	subscriptionFindFirst,
	organizationFindFirst,
	insertValues,
	onConflictDoNothing,
	setValues,
	updateWhere,
	logger,
} = vi.hoisted(() => ({
	stripeEventFindFirst: vi.fn(),
	subscriptionFindFirst: vi.fn(),
	organizationFindFirst: vi.fn(),
	insertValues: vi.fn(),
	onConflictDoNothing: vi.fn(),
	setValues: vi.fn(),
	updateWhere: vi.fn(),
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => logger,
}));

vi.mock("@/db", () => {
	const db = {
		query: {
			stripeEvent: {
				findFirst: stripeEventFindFirst,
			},
			subscription: {
				findFirst: subscriptionFindFirst,
			},
			organization: {
				findFirst: organizationFindFirst,
			},
		},
		insert: vi.fn(() => ({
			values: insertValues,
		})),
		update: vi.fn(() => ({
			set: setValues,
		})),
		// Protected billing mutations resolve the owning organization, then lock it.
		select: vi.fn(() => ({
			from: () => ({ where: async () => [{ organizationId: "org_123" }] }),
		})),
		execute: vi.fn(async () => undefined),
		transaction: vi.fn(async (callback: (transaction: unknown) => unknown) => callback(db)),
	};
	return { db };
});

vi.mock("drizzle-orm", async (importOriginal) => ({
	...(await importOriginal<typeof import("drizzle-orm")>()),
	eq: vi.fn((column, value) => ({ column, value })),
}));

vi.mock("@/lib/billing/billing-system-email", () => ({
	sendBillingSystemEmail: vi.fn(),
}));

const sendBillingSystemEmailMock = vi.mocked(sendBillingSystemEmail);

describe("BillingEventsService", () => {
	const getCustomer = vi.fn();
	const getInvoiceForPaymentIntent = vi.fn();
	const updateFromStripe = vi.fn((_: UpdateSubscriptionFromStripeParams) => Effect.void);
	const getSubscription = vi.fn();
	const createSubscription = vi.fn((_: CreateSubscriptionParams) => Effect.void);
	const syncSeatsForOrganization = vi.fn((_: string) => Effect.succeed(1));
	const appLayer = Layer.mergeAll(
		DatabaseServiceLive,
		Layer.succeed(
			StripeService,
			StripeService.of({
				client: null,
				config: {
					secretKey: "",
					webhookSecret: "",
					priceMonthlyId: "price_monthly_123",
					priceYearlyId: "price_yearly_123",
					enabled: false,
				},
				createCustomer: vi.fn(),
				getCustomer,
				createCheckoutSession: vi.fn(),
				createPortalSession: vi.fn(),
				getSubscription,
				updateSubscription: vi.fn(),
				cancelSubscription: vi.fn(),
				getInvoiceForPaymentIntent,
				constructWebhookEvent: vi.fn(),
			}),
		),
		Layer.succeed(
			SubscriptionService,
			SubscriptionService.of({
				getByOrganization: vi.fn(),
				getByStripeCustomerId: vi.fn(),
				getByStripeSubscriptionId: vi.fn(),
				requireActiveSubscription: vi.fn(),
				ensureLocalTrial: vi.fn(),
				create: createSubscription,
				updateFromStripe,
				updateSeatCount: vi.fn(),
				setStripeCustomerId: vi.fn(),
				canMutateData: vi.fn(),
			}),
		),
		Layer.succeed(
			SeatSyncService,
			SeatSyncService.of({
				syncSeatsForOrganization,
				handleMemberAdded: vi.fn(),
				handleMemberRemoved: vi.fn(),
				handleKioskSeatUpgraded: vi.fn(),
				getCurrentSeatCount: vi.fn(),
			}),
		),
	);

	beforeEach(() => {
		vi.clearAllMocks();
		stripeEventFindFirst.mockResolvedValue(null);
		subscriptionFindFirst.mockResolvedValue({
			organizationId: "org_123",
			metadata: {},
		});
		organizationFindFirst.mockResolvedValue({
			id: "org_123",
			name: "Acme GmbH",
			timezone: "America/New_York",
		});
		insertValues.mockReturnValue({ onConflictDoNothing });
		onConflictDoNothing.mockResolvedValue(undefined);
		setValues.mockReturnValue({ where: updateWhere });
		updateWhere.mockResolvedValue(undefined);
		updateFromStripe.mockReturnValue(Effect.void);
		getCustomer.mockReturnValue(
			Effect.succeed({
				id: "cus_test_123",
				object: "customer",
				email: "billing@example.com",
			} as Stripe.Customer),
		);
		getInvoiceForPaymentIntent.mockReturnValue(Effect.succeed(createStripeInvoice()));
		sendBillingSystemEmailMock.mockResolvedValue({ sent: true });
	});

	it("preserves active status when an updated subscription is scheduled to cancel", async () => {
		const cancelAt = 1_779_840_000;
		const stripeSub = createStripeSubscription({
			status: "active",
			cancel_at: cancelAt,
			cancel_at_period_end: true,
		});

		await processEvent({
			type: "customer.subscription.updated",
			stripeSub,
		});

		expect(updateFromStripe).toHaveBeenCalledWith(
			expect.objectContaining({
				stripeSubscriptionId: "sub_test_123",
				status: "active",
				cancelAt: new Date(cancelAt * 1000),
			}),
		);
		expect(updateFromStripe).not.toHaveBeenCalledWith(
			expect.objectContaining({ status: "canceled" }),
		);
	});

	it("marks deleted subscriptions canceled locally", async () => {
		const stripeSub = createStripeSubscription({ status: "active" });

		await processEvent({
			type: "customer.subscription.deleted",
			stripeSub,
		});

		expect(updateFromStripe).toHaveBeenCalledWith(
			expect.objectContaining({
				stripeSubscriptionId: "sub_test_123",
				status: "canceled",
				canceledAt: expect.any(Date),
			}),
		);
	});

	it("sends trial ending billing mail through the system sender", async () => {
		const stripeSub = createStripeSubscription({
			trial_end: 1_779_840_000,
			customer: "cus_test_123",
		});

		await processEvent({
			type: "customer.subscription.trial_will_end",
			stripeSub,
		});

		expect(getCustomer).toHaveBeenCalledWith("cus_test_123");
		expect(sendBillingSystemEmailMock).toHaveBeenCalledWith({
			templateKey: "billing-trial-ending",
			to: "billing@example.com",
			organizationId: "org_123",
			data: expect.objectContaining({
				organizationName: "Acme GmbH",
				customerEmail: "billing@example.com",
				billingUrl: "https://app.z8-time.app/settings/billing",
				billingPortalUrl: "https://app.z8-time.app/settings/billing",
				// 2026-05-27T00:00Z is still May 26 in the organization's timezone.
				trialEndsAt: notificationParam.plainDate(parsePlainDate("2026-05-26")),
			}),
		});
		expect(eq).toHaveBeenCalledWith(expect.anything(), "sub_test_123");
		expect(updateWhere).toHaveBeenCalled();
	});

	it("finds the billed organization through the subscription row", async () => {
		subscriptionFindFirst.mockResolvedValue({ organizationId: "org_from_row", metadata: {} });
		organizationFindFirst.mockResolvedValue({
			id: "org_from_row",
			name: "Acme GmbH",
			timezone: "America/New_York",
		});

		await processEvent({
			type: "invoice.finalized",
			object: createStripeInvoice({ parent: subscriptionParent("sub_row_123") }),
		});

		expect(eq).toHaveBeenCalledWith(expect.anything(), "sub_row_123");
		expect(eq).toHaveBeenCalledWith(expect.anything(), "org_from_row");
		expect(sendBillingSystemEmailMock).toHaveBeenCalledWith(
			expect.objectContaining({
				templateKey: "billing-invoice-ready",
				organizationId: "org_from_row",
				data: expect.objectContaining({
					organizationName: "Acme GmbH",
					invoiceAmount: notificationParam.money("123.00", "EUR"),
					dueDate: notificationParam.plainDate(parsePlainDate("2026-05-26")),
				}),
			}),
		);
	});

	it("leaves the organization name and dates to the sender when nothing identifies the organization", async () => {
		subscriptionFindFirst.mockResolvedValue(undefined);

		await processEvent({
			type: "invoice.finalized",
			object: createStripeInvoice({ due_date: null }),
		});

		const params = sendBillingSystemEmailMock.mock.calls[0][0];
		expect(params.organizationId).toBeUndefined();
		expect(params.data.organizationName).toBeUndefined();
		expect(params.data.dueDate).toBeUndefined();
		expect(organizationFindFirst).not.toHaveBeenCalled();
	});

	it("states the invoice's next retry in the payment failed email", async () => {
		getInvoiceForPaymentIntent.mockReturnValue(
			Effect.succeed(createStripeInvoice({ next_payment_attempt: 1_779_926_400 })),
		);

		await processEvent({
			type: "payment_intent.payment_failed",
			object: createStripePaymentIntent(),
		});

		expect(sendBillingSystemEmailMock).toHaveBeenCalledWith(
			expect.objectContaining({
				templateKey: "billing-payment-failed",
				organizationId: "org_123",
				data: expect.objectContaining({
					invoiceAmount: notificationParam.money("123.00", "EUR"),
					paymentRetryDate: notificationParam.plainDate(parsePlainDate("2026-05-27")),
				}),
			}),
		);
	});

	it("dates a resumed subscription by the organization's calendar", async () => {
		await processEvent({
			type: "customer.subscription.resumed",
			object: createStripeSubscription({ customer: "cus_test_123" }),
		});

		const params = sendBillingSystemEmailMock.mock.calls[0][0];
		expect(params.data.resumeDate).toEqual({ kind: "plainDate", date: expect.any(String) });
	});

	it.each([
		{
			type: "customer.subscription.paused" as const,
			object: createStripeSubscription({
				customer: {
					id: "cus_test_123",
					object: "customer",
					email: "paused@example.com",
				} as Stripe.Customer,
				pause_collection: { behavior: "void", resumes_at: null },
			}),
			templateKey: "billing-subscription-paused",
		},
		{
			type: "customer.subscription.resumed" as const,
			object: createStripeSubscription({
				customer: {
					id: "cus_test_123",
					object: "customer",
					email: "resumed@example.com",
				} as Stripe.Customer,
			}),
			templateKey: "billing-subscription-resumed",
		},
		{
			type: "invoice.finalized" as const,
			object: createStripeInvoice({ customer_email: "invoice@example.com" }),
			templateKey: "billing-invoice-ready",
		},
		{
			type: "payment_intent.payment_failed" as const,
			object: createStripePaymentIntent({
				receipt_email: "payment@example.com",
			}),
			templateKey: "billing-payment-failed",
		},
	])("selects $templateKey for $type", async ({ type, object, templateKey }) => {
		await processEvent({ type, object });

		expect(sendBillingSystemEmailMock).toHaveBeenCalledWith(
			expect.objectContaining({ templateKey }),
		);
	});

	it("continues processing when billing email sending fails", async () => {
		sendBillingSystemEmailMock.mockRejectedValueOnce(new Error("email unavailable"));

		await expect(
			processEvent({
				type: "customer.subscription.paused",
				object: createStripeSubscription({ customer: "cus_test_123" }),
			}),
		).resolves.toBeUndefined();

		expect(sendBillingSystemEmailMock).toHaveBeenCalledWith(
			expect.objectContaining({ templateKey: "billing-subscription-paused" }),
		);
		expect(setValues).toHaveBeenCalledWith(expect.objectContaining({ processed: true }));
	});

	describe.each([
		{
			shape: "current shape with a subscription ID",
			invoice: () => createStripeInvoice({ parent: subscriptionParent("sub_shape_123") }),
		},
		{
			shape: "current shape with an expanded subscription",
			invoice: () =>
				createStripeInvoice({
					parent: subscriptionParent(createStripeSubscription({ id: "sub_shape_123" })),
				}),
		},
		{
			shape: "legacy shape with a subscription ID",
			invoice: () => createLegacyStripeInvoice("sub_shape_123"),
		},
		{
			shape: "legacy shape with an expanded subscription",
			invoice: () => createLegacyStripeInvoice({ id: "sub_shape_123", object: "subscription" }),
		},
	])("invoice in the $shape", ({ invoice }) => {
		it("activates the subscription when the payment succeeds", async () => {
			await processEvent({ type: "invoice.payment_succeeded", object: invoice() });

			expect(eq).toHaveBeenCalledWith(expect.anything(), "sub_shape_123");
			expect(setValues).toHaveBeenCalledWith({ status: "active" });
		});

		it("marks the subscription past due when the payment fails", async () => {
			await processEvent({ type: "invoice.payment_failed", object: invoice() });

			expect(eq).toHaveBeenCalledWith(expect.anything(), "sub_shape_123");
			expect(setValues).toHaveBeenCalledWith({ status: "past_due" });
		});

		it("stores the finalized invoice and sends the invoice email", async () => {
			await processEvent({ type: "invoice.finalized", object: invoice() });

			expect(eq).toHaveBeenCalledWith(expect.anything(), "sub_shape_123");
			expect(setValues).toHaveBeenCalledWith({
				metadata: {
					lastInvoice: expect.objectContaining({ id: "in_test_123", number: "INV-123" }),
				},
			});
			expect(sendBillingSystemEmailMock).toHaveBeenCalledWith(
				expect.objectContaining({ templateKey: "billing-invoice-ready" }),
			);
		});
	});

	it.each(["invoice.payment_succeeded", "invoice.payment_failed", "invoice.finalized"] as const)(
		"ignores a %s invoice without a subscription",
		async (type) => {
			await processEvent({ type, object: createStripeInvoice({ parent: null }) });

			expect(setValues).not.toHaveBeenCalledWith(
				expect.objectContaining({ status: expect.anything() }),
			);
			expect(setValues).not.toHaveBeenCalledWith(
				expect.objectContaining({ metadata: expect.anything() }),
			);
			expect(sendBillingSystemEmailMock).not.toHaveBeenCalled();
			expect(setValues).toHaveBeenCalledWith(expect.objectContaining({ processed: true }));
		},
	);

	describe("failed payment intent", () => {
		it("logs the looked-up invoice and links it in the payment failed email", async () => {
			getInvoiceForPaymentIntent.mockReturnValue(
				Effect.succeed(createStripeInvoice({ id: "in_lookup_123" })),
			);

			await processEvent({
				type: "payment_intent.payment_failed",
				object: createStripePaymentIntent(),
			});

			expect(getInvoiceForPaymentIntent).toHaveBeenCalledWith("pi_test_123");
			expect(logger.warn).toHaveBeenCalledWith(
				expect.objectContaining({ paymentIntentId: "pi_test_123", invoiceId: "in_lookup_123" }),
				"Payment intent failed",
			);
			expect(sendBillingSystemEmailMock).toHaveBeenCalledWith(
				expect.objectContaining({
					templateKey: "billing-payment-failed",
					data: expect.objectContaining({
						invoiceUrl: "https://app.z8-time.app/settings/billing",
					}),
				}),
			);
		});

		it("prefers the payment intent's subscription metadata", async () => {
			getInvoiceForPaymentIntent.mockReturnValue(
				Effect.succeed(createStripeInvoice({ parent: subscriptionParent("sub_invoice_123") })),
			);

			await processEvent({
				type: "payment_intent.payment_failed",
				object: createStripePaymentIntent(),
			});

			expect(eq).toHaveBeenCalledWith(expect.anything(), "sub_test_123");
			expect(eq).not.toHaveBeenCalledWith(expect.anything(), "sub_invoice_123");
		});

		it("stores the failure on the invoice's subscription when metadata has none", async () => {
			getInvoiceForPaymentIntent.mockReturnValue(
				Effect.succeed(createStripeInvoice({ parent: subscriptionParent("sub_invoice_123") })),
			);

			await processEvent({
				type: "payment_intent.payment_failed",
				object: createStripePaymentIntent({ metadata: {} }),
			});

			expect(eq).toHaveBeenCalledWith(expect.anything(), "sub_invoice_123");
			expect(setValues).toHaveBeenCalledWith({
				metadata: {
					lastPaymentFailure: expect.objectContaining({
						paymentIntentId: "pi_test_123",
						failureCode: "card_declined",
					}),
				},
			});
		});

		it.each([
			{
				lookup: "fails",
				result: () =>
					Effect.fail(
						new StripeError({
							message: "Failed to look up invoice",
							operation: "getInvoiceForPaymentIntent",
						}),
					),
			},
			{ lookup: "finds no invoice", result: () => Effect.succeed(null) },
		])("still processes the event when the invoice lookup $lookup", async ({ result }) => {
			getInvoiceForPaymentIntent.mockReturnValue(result());

			await expect(
				processEvent({
					type: "payment_intent.payment_failed",
					object: createStripePaymentIntent({ metadata: {} }),
				}),
			).resolves.toBeUndefined();

			expect(logger.warn).toHaveBeenCalledWith(
				expect.objectContaining({ paymentIntentId: "pi_test_123" }),
				"No invoice resolved for failed payment intent",
			);
			expect(logger.warn).toHaveBeenCalledWith(
				expect.objectContaining({ invoiceId: undefined }),
				"Payment intent failed",
			);
			expect(sendBillingSystemEmailMock).toHaveBeenCalledWith(
				expect.objectContaining({
					templateKey: "billing-payment-failed",
					data: expect.objectContaining({ invoiceUrl: undefined }),
				}),
			);
			expect(setValues).toHaveBeenCalledWith(expect.objectContaining({ processed: true }));
		});
	});

	describe("full seat item found by price", () => {
		/** An add-on at a price billing does not know, listed before the seat item. */
		const unknownItem = {
			id: "si_addon_123",
			object: "subscription_item",
			quantity: 9,
			current_period_start: 1_700_000_000,
			current_period_end: 1_700_086_400,
			price: { id: "price_addon_123", object: "price", recurring: { interval: "month" } },
		} as Stripe.SubscriptionItem;
		const yearlySeatItem = {
			id: "si_seat_123",
			object: "subscription_item",
			quantity: 4,
			current_period_start: 1_769_472_000,
			current_period_end: 1_801_008_000,
			price: { id: "price_yearly_123", object: "price", recurring: { interval: "year" } },
		} as Stripe.SubscriptionItem;
		const withItems = (...data: Stripe.SubscriptionItem[]) =>
			createStripeSubscription({
				items: {
					object: "list",
					data,
					has_more: false,
					url: "/v1/subscription_items?subscription=sub_test_123",
				},
			});

		it("reads price, interval and period of an updated subscription from the seat item", async () => {
			await processEvent({
				type: "customer.subscription.updated",
				stripeSub: withItems(unknownItem, yearlySeatItem),
			});

			expect(updateFromStripe).toHaveBeenCalledWith(
				expect.objectContaining({
					stripePriceId: "price_yearly_123",
					billingInterval: "year",
					currentPeriodStart: new Date(1_769_472_000 * 1000),
					currentPeriodEnd: new Date(1_801_008_000 * 1000),
				}),
			);
		});

		it("reads the period of a deleted subscription from the seat item", async () => {
			await processEvent({
				type: "customer.subscription.deleted",
				stripeSub: withItems(unknownItem, yearlySeatItem),
			});

			expect(updateFromStripe).toHaveBeenCalledWith(
				expect.objectContaining({
					status: "canceled",
					currentPeriodStart: new Date(1_769_472_000 * 1000),
					currentPeriodEnd: new Date(1_801_008_000 * 1000),
				}),
			);
		});

		it("reads the period of a resumed subscription from the seat item", async () => {
			await processEvent({
				type: "customer.subscription.resumed",
				stripeSub: withItems(unknownItem, yearlySeatItem),
			});

			expect(setValues).toHaveBeenCalledWith(
				expect.objectContaining({
					status: "active",
					currentPeriodStart: new Date(1_769_472_000 * 1000),
					currentPeriodEnd: new Date(1_801_008_000 * 1000),
				}),
			);
		});

		it("creates the local subscription from the seat item on checkout", async () => {
			getSubscription.mockReturnValue(Effect.succeed(withItems(unknownItem, yearlySeatItem)));

			await processEvent({
				type: "checkout.session.completed",
				object: {
					id: "cs_test_123",
					object: "checkout.session",
					metadata: { organizationId: "org_123" },
					subscription: "sub_test_123",
					customer: "cus_test_123",
				} as Stripe.Checkout.Session,
			});

			expect(getSubscription).toHaveBeenCalledWith("sub_test_123");
			expect(createSubscription).toHaveBeenCalledWith(
				expect.objectContaining({
					organizationId: "org_123",
					stripePriceId: "price_yearly_123",
					billingInterval: "year",
					currentPeriodStart: new Date(1_769_472_000 * 1000),
					currentPeriodEnd: new Date(1_801_008_000 * 1000),
					seats: 4,
				}),
			);
			expect(syncSeatsForOrganization).toHaveBeenCalledWith("org_123");
		});

		it("treats a subscription without a seat item like one without items", async () => {
			await processEvent({ type: "customer.subscription.updated", stripeSub: withItems() });
			await processEvent({
				type: "customer.subscription.updated",
				stripeSub: withItems(unknownItem),
			});

			const [withoutItems, unknownOnly] = updateFromStripe.mock.calls.map(([params]) => params);
			expect(unknownOnly).toMatchObject({ stripePriceId: undefined, billingInterval: "month" });
			expect(unknownOnly.currentPeriodStart).not.toEqual(new Date(1_700_000_000 * 1000));
			expect({ ...unknownOnly, currentPeriodStart: null, currentPeriodEnd: null }).toEqual({
				...withoutItems,
				currentPeriodStart: null,
				currentPeriodEnd: null,
			});
		});

		describe("kiosk seat item (#886)", () => {
			const kioskSeatItem = {
				id: "si_kiosk_123",
				object: "subscription_item",
				quantity: 5,
				current_period_start: 1_769_472_000,
				current_period_end: 1_801_008_000,
				price: { id: "price_kiosk_yearly_123", object: "price", recurring: { interval: "year" } },
			} as Stripe.SubscriptionItem;
			const kioskStripeLayer = Layer.succeed(
				StripeService,
				StripeService.of({
					client: null,
					config: {
						secretKey: "",
						webhookSecret: "",
						priceMonthlyId: "price_monthly_123",
						priceYearlyId: "price_yearly_123",
						priceKioskMonthlyId: "price_kiosk_monthly_123",
						priceKioskYearlyId: "price_kiosk_yearly_123",
						enabled: false,
					},
					createCustomer: vi.fn(),
					getCustomer,
					createCheckoutSession: vi.fn(),
					createPortalSession: vi.fn(),
					getSubscription,
					updateSubscription: vi.fn(),
					cancelSubscription: vi.fn(),
					getInvoiceForPaymentIntent,
					constructWebhookEvent: vi.fn(),
				}),
			);
			const checkoutCompleted = {
				id: "cs_test_123",
				object: "checkout.session",
				metadata: { organizationId: "org_123" },
				subscription: "sub_test_123",
				customer: "cus_test_123",
			} as Stripe.Checkout.Session;

			it("reads the kiosk item by price as the kiosk quantity on checkout", async () => {
				getSubscription.mockReturnValue(
					Effect.succeed(withItems(kioskSeatItem, unknownItem, yearlySeatItem)),
				);

				await processEvent({
					type: "checkout.session.completed",
					object: checkoutCompleted,
					stripeLayer: kioskStripeLayer,
				});

				expect(createSubscription).toHaveBeenCalledWith(
					expect.objectContaining({
						stripePriceId: "price_yearly_123",
						billingInterval: "year",
						seats: 9,
						kioskSeats: 5,
					}),
				);
			});

			it("does not count a kiosk price item as seats while kiosk seats are off", async () => {
				getSubscription.mockReturnValue(Effect.succeed(withItems(kioskSeatItem, yearlySeatItem)));

				await processEvent({ type: "checkout.session.completed", object: checkoutCompleted });

				expect(createSubscription).toHaveBeenCalledWith(
					expect.objectContaining({ seats: 4, kioskSeats: 0 }),
				);
			});
		});
	});

	async function processEvent({
		type,
		stripeSub,
		object = stripeSub,
		stripeLayer,
	}: {
		stripeLayer?: Layer.Layer<StripeService>;
		type:
			| "checkout.session.completed"
			| "customer.subscription.updated"
			| "customer.subscription.deleted"
			| "customer.subscription.trial_will_end"
			| "customer.subscription.paused"
			| "customer.subscription.resumed"
			| "invoice.payment_succeeded"
			| "invoice.payment_failed"
			| "invoice.finalized"
			| "payment_intent.payment_failed";
		stripeSub?: Stripe.Subscription;
		object?: Stripe.Subscription | Stripe.Invoice | Stripe.PaymentIntent | Stripe.Checkout.Session;
	}) {
		await Effect.runPromise(
			Effect.gen(function* () {
				const billingEventsService = yield* BillingEventsService;

				yield* billingEventsService.processEvent({
					id: `evt_${type}`,
					type,
					data: { object },
				} as Stripe.Event);
			}).pipe(
				Effect.provide(BillingEventsServiceLive),
				Effect.provide(stripeLayer ? Layer.merge(appLayer, stripeLayer) : appLayer),
			),
		);
	}
});

function createStripeSubscription(
	overrides: Partial<Stripe.Subscription> = {},
): Stripe.Subscription {
	return {
		id: "sub_test_123",
		object: "subscription",
		status: "active",
		metadata: { organizationId: "org_123" },
		cancel_at: null,
		cancel_at_period_end: false,
		canceled_at: null,
		items: {
			object: "list",
			data: [
				{
					id: "si_test_123",
					object: "subscription_item",
					current_period_start: 1_769_472_000,
					current_period_end: 1_772_064_000,
					price: {
						id: "price_monthly_123",
						object: "price",
						recurring: { interval: "month" },
					},
				},
			],
			has_more: false,
			url: "/v1/subscription_items?subscription=sub_test_123",
		},
		...overrides,
	} as Stripe.Subscription;
}

function createStripeInvoice(overrides: Partial<Stripe.Invoice> = {}): Stripe.Invoice {
	return {
		id: "in_test_123",
		object: "invoice",
		amount_due: 12_300,
		amount_paid: 0,
		currency: "eur",
		customer: "cus_test_123",
		customer_email: "billing@example.com",
		due_date: 1_779_840_000,
		hosted_invoice_url: "https://invoice.stripe.test/in_test_123",
		invoice_pdf: "https://invoice.stripe.test/in_test_123.pdf",
		number: "INV-123",
		status: "open",
		parent: subscriptionParent("sub_test_123"),
		...overrides,
	} as Stripe.Invoice;
}

function subscriptionParent(subscription: string | Stripe.Subscription): Stripe.Invoice.Parent {
	return {
		type: "subscription_details",
		quote_details: null,
		subscription_details: { metadata: null, subscription },
	};
}

/** An invoice rendered in a webhook API version before 2025-03-31.basil. */
function createLegacyStripeInvoice(
	subscription: string | Pick<Stripe.Subscription, "id" | "object">,
): Stripe.Invoice {
	return { ...createStripeInvoice({ parent: null }), subscription } as Stripe.Invoice;
}

function createStripePaymentIntent(
	overrides: Partial<Stripe.PaymentIntent> = {},
): Stripe.PaymentIntent {
	return {
		id: "pi_test_123",
		object: "payment_intent",
		amount: 12_300,
		currency: "eur",
		customer: "cus_test_123",
		last_payment_error: {
			code: "card_declined",
			decline_code: "generic_decline",
			message: "Your card was declined.",
			type: "card_error",
		} as Stripe.PaymentIntent.LastPaymentError,
		metadata: { subscriptionId: "sub_test_123" },
		receipt_email: "billing@example.com",
		status: "requires_payment_method",
		...overrides,
	} as Stripe.PaymentIntent;
}

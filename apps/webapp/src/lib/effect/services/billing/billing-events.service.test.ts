import { Effect, Layer } from "effect";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BillingEventsService, BillingEventsServiceLive } from "./billing-events.service";
import { sendBillingSystemEmail } from "@/lib/billing/billing-system-email";
import { SeatSyncService } from "./seat-sync.service";
import { StripeService } from "./stripe.service";
import { SubscriptionService, type UpdateSubscriptionFromStripeParams } from "./subscription.service";

const {
	stripeEventFindFirst,
	subscriptionFindFirst,
	insertValues,
	onConflictDoNothing,
	setValues,
	updateWhere,
} = vi.hoisted(() => ({
	stripeEventFindFirst: vi.fn(),
	subscriptionFindFirst: vi.fn(),
	insertValues: vi.fn(),
	onConflictDoNothing: vi.fn(),
	setValues: vi.fn(),
	updateWhere: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			stripeEvent: {
				findFirst: stripeEventFindFirst,
			},
			subscription: {
				findFirst: subscriptionFindFirst,
			},
		},
		insert: vi.fn(() => ({
			values: insertValues,
		})),
		update: vi.fn(() => ({
			set: setValues,
		})),
	},
}));

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
	const updateFromStripe = vi.fn((_: UpdateSubscriptionFromStripeParams) => Effect.void);
	const appLayer = Layer.mergeAll(
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
				getSubscription: vi.fn(),
				updateSubscription: vi.fn(),
				cancelSubscription: vi.fn(),
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
				create: vi.fn(),
				updateFromStripe,
				updateSeatCount: vi.fn(),
				setStripeCustomerId: vi.fn(),
				canMutateData: vi.fn(),
			}),
		),
		Layer.succeed(
			SeatSyncService,
			SeatSyncService.of({
				syncSeatsForOrganization: vi.fn(),
				handleMemberAdded: vi.fn(),
				handleMemberRemoved: vi.fn(),
				getCurrentSeatCount: vi.fn(),
			}),
		),
	);

	beforeEach(() => {
		vi.clearAllMocks();
		stripeEventFindFirst.mockResolvedValue(null);
		subscriptionFindFirst.mockResolvedValue({
			metadata: {},
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
			data: expect.objectContaining({
				organizationName: "your organization",
				customerEmail: "billing@example.com",
				billingUrl: "https://app.z8-time.app/settings/billing",
				billingPortalUrl: "https://app.z8-time.app/settings/billing",
			}),
		});
		expect(updateWhere).toHaveBeenCalled();
	});

	it.each([
		{
			type: "customer.subscription.paused" as const,
			object: createStripeSubscription({
				customer: { id: "cus_test_123", object: "customer", email: "paused@example.com" } as Stripe.Customer,
				pause_collection: { behavior: "void" },
			}),
			templateKey: "billing-subscription-paused",
		},
		{
			type: "customer.subscription.resumed" as const,
			object: createStripeSubscription({
				customer: { id: "cus_test_123", object: "customer", email: "resumed@example.com" } as Stripe.Customer,
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
			object: createStripePaymentIntent({ receipt_email: "payment@example.com" }),
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

	async function processEvent({
		type,
		stripeSub,
		object = stripeSub,
	}: {
		type:
			| "customer.subscription.updated"
			| "customer.subscription.deleted"
			| "customer.subscription.trial_will_end"
			| "customer.subscription.paused"
			| "customer.subscription.resumed"
			| "invoice.finalized"
			| "payment_intent.payment_failed";
		stripeSub?: Stripe.Subscription;
		object?: Stripe.Subscription | Stripe.Invoice | Stripe.PaymentIntent;
	}) {
		await Effect.runPromise(
			Effect.gen(function* () {
				const billingEventsService = yield* BillingEventsService;

				yield* billingEventsService.processEvent({
					id: `evt_${type}`,
					type,
					data: { object },
				} as Stripe.Event);
			}).pipe(Effect.provide(BillingEventsServiceLive), Effect.provide(appLayer)),
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
		subscription: "sub_test_123",
		...overrides,
	} as Stripe.Invoice;
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
		invoice: "in_test_123",
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

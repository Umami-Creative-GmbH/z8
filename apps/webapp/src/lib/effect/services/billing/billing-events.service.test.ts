import { Effect, Layer } from "effect";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BillingEventsService, BillingEventsServiceLive } from "./billing-events.service";
import { SeatSyncService } from "./seat-sync.service";
import { StripeService } from "./stripe.service";
import { SubscriptionService, type UpdateSubscriptionFromStripeParams } from "./subscription.service";

const {
	stripeEventFindFirst,
	insertValues,
	onConflictDoNothing,
	setValues,
	updateWhere,
} = vi.hoisted(() => ({
	stripeEventFindFirst: vi.fn(),
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

describe("BillingEventsService", () => {
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
				getCustomer: vi.fn(),
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
		insertValues.mockReturnValue({ onConflictDoNothing });
		onConflictDoNothing.mockResolvedValue(undefined);
		setValues.mockReturnValue({ where: updateWhere });
		updateWhere.mockResolvedValue(undefined);
		updateFromStripe.mockReturnValue(Effect.void);
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

	async function processEvent({
		type,
		stripeSub,
	}: {
		type: "customer.subscription.updated" | "customer.subscription.deleted";
		stripeSub: Stripe.Subscription;
	}) {
		await Effect.runPromise(
			Effect.gen(function* () {
				const billingEventsService = yield* BillingEventsService;

				yield* billingEventsService.processEvent({
					id: `evt_${type}`,
					type,
					data: { object: stripeSub },
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

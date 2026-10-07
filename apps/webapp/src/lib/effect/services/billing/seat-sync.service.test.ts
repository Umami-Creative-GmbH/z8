import { Effect, Exit, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import { typedFailureOfCause } from "@/lib/effect/cause-failure";
import { StripeError } from "@/lib/effect/errors";
import { SeatDeliveryUncertainError } from "./seat-delivery";
import { SeatSyncService, SeatSyncServiceLive } from "./seat-sync.service";
import { StripeService } from "./stripe.service";
import { SubscriptionService } from "./subscription.service";

const { countBillableSeats, database, deliverOrganizationSeats } = vi.hoisted(() => ({
	countBillableSeats: vi.fn(),
	database: { marker: "db" },
	deliverOrganizationSeats: vi.fn(),
}));

vi.mock("@/db", () => ({ db: database }));

// Lock and ordering semantics are covered by seat-sync-ordering.integration.test.ts.
vi.mock("@/lib/effect/services/billing/seat-delivery", async (importOriginal) => ({
	...(await importOriginal<typeof import("./seat-delivery")>()),
	deliverOrganizationSeats,
}));

// Seat semantics are covered by billable-seat-count.integration.test.ts.
vi.mock("@/lib/effect/services/billing/billable-seat-count", () => ({ countBillableSeats }));

describe("SeatSyncService", () => {
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
				getCustomer: vi.fn(),
				createCheckoutSession: vi.fn(),
				createPortalSession: vi.fn(),
				getSubscription: vi.fn(),
				updateSubscription: vi.fn(),
				cancelSubscription: vi.fn(),
				getInvoiceForPaymentIntent: vi.fn(),
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
				updateFromStripe: vi.fn(),
				updateSeatCount: vi.fn(),
				setStripeCustomerId: vi.fn(),
				canMutateData: vi.fn(),
			}),
		),
	);

	beforeEach(() => {
		vi.clearAllMocks();
		countBillableSeats.mockResolvedValue(1);
	});

	it("counts seats with the shared billable-seat definition", async () => {
		countBillableSeats.mockResolvedValueOnce(3);

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const seatSyncService = yield* SeatSyncService;

				return yield* seatSyncService.getCurrentSeatCount("org_123");
			}).pipe(Effect.provide(SeatSyncServiceLive), Effect.provide(appLayer)),
		);

		expect(result).toBe(3);
		expect(countBillableSeats).toHaveBeenCalledWith(database, "org_123");
	});

	describe("Stripe seat delivery", () => {
		const stripeSubscription = { items: { data: [{ id: "si_123", quantity: 2 }] } };

		function enabledStripeLayer(
			overrides: Partial<{
				getSubscription: (id: string) => Effect.Effect<unknown, StripeError>;
			}> = {},
		) {
			const updateSubscription = vi.fn(() => Effect.succeed(stripeSubscription));
			const getSubscription = vi.fn(
				overrides.getSubscription ?? (() => Effect.succeed(stripeSubscription)),
			);
			const layer = Layer.succeed(
				StripeService,
				StripeService.of({
					client: null,
					config: {
						secretKey: "rk_test_123",
						webhookSecret: "",
						priceMonthlyId: "price_monthly_123",
						priceYearlyId: "price_yearly_123",
						enabled: true,
					},
					createCustomer: vi.fn(),
					getCustomer: vi.fn(),
					createCheckoutSession: vi.fn(),
					createPortalSession: vi.fn(),
					getSubscription: getSubscription as never,
					updateSubscription: updateSubscription as never,
					cancelSubscription: vi.fn(),
					getInvoiceForPaymentIntent: vi.fn(),
					constructWebhookEvent: vi.fn(),
				}),
			);
			return { layer, getSubscription, updateSubscription };
		}

		function syncSeats(stripeLayer: Layer.Layer<StripeService>) {
			return Effect.runPromiseExit(
				Effect.flatMap(SeatSyncService, (service) =>
					service.syncSeatsForOrganization("org_123"),
				).pipe(
					Effect.provide(SeatSyncServiceLive),
					Effect.provide(Layer.merge(appLayer, stripeLayer)),
				),
			);
		}

		it("delivers the seat quantity through the StripeService", async () => {
			const stripe = enabledStripeLayer();
			deliverOrganizationSeats.mockImplementation(async ({ stripe: port }) => {
				const current = await port.getQuantity("sub_123");
				await port.setQuantity({
					subscriptionId: "sub_123",
					itemId: current.itemId,
					quantity: 4,
					idempotencyKey: "seat-sync:org_123:7",
				});
				return { seats: 4, local: "updated", external: "confirmed" };
			});

			const exit = await syncSeats(stripe.layer);

			expect(exit).toEqual(Exit.succeed(4));
			expect(stripe.getSubscription).toHaveBeenCalledWith("sub_123");
			expect(stripe.updateSubscription).toHaveBeenCalledWith(
				"sub_123",
				{ items: [{ id: "si_123", quantity: 4 }], proration_behavior: "create_prorations" },
				{ idempotencyKey: "seat-sync:org_123:7" },
			);
		});

		it("hands a Stripe failure to the delivery as a rejection", async () => {
			const stripeFailure = new StripeError({
				message: "Failed to get subscription",
				operation: "getSubscription",
			});
			const stripe = enabledStripeLayer({ getSubscription: () => Effect.fail(stripeFailure) });
			let rejection: unknown;
			deliverOrganizationSeats.mockImplementation(async ({ stripe: port }) => {
				rejection = await port.getQuantity("sub_123").catch((error: unknown) => error);
				throw new SeatDeliveryUncertainError("org_123", 7, rejection);
			});

			const exit = await syncSeats(stripe.layer);

			expect(rejection).toBe(stripeFailure);
			expect(Exit.isFailure(exit) ? typedFailureOfCause(exit.cause) : undefined).toMatchObject({
				_tag: "StripeError",
				operation: "syncSeatsForOrganization",
			});
		});
	});
});

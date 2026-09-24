import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SeatSyncService, SeatSyncServiceLive } from "./seat-sync.service";
import { StripeService } from "./stripe.service";
import { SubscriptionService } from "./subscription.service";

const { countBillableSeats, database } = vi.hoisted(() => ({
	countBillableSeats: vi.fn(),
	database: { marker: "db" },
}));

vi.mock("@/db", () => ({ db: database }));

// Seat semantics are covered by billable-seat-count.integration.test.ts.
vi.mock("./billable-seat-count", () => ({ countBillableSeats }));

describe("SeatSyncService", () => {
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
});

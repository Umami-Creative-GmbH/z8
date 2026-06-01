import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { member, user } from "@/db/auth-schema";
import { SeatSyncService, SeatSyncServiceLive } from "./seat-sync.service";
import { StripeService } from "./stripe.service";
import { SubscriptionService } from "./subscription.service";

const { select, selectFrom, selectInnerJoin, selectWhere } = vi.hoisted(() => ({
	select: vi.fn(),
	selectFrom: vi.fn(),
	selectInnerJoin: vi.fn(),
	selectWhere: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		select,
	},
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
	...(await importOriginal<typeof import("drizzle-orm")>()),
	and: vi.fn((...conditions) => ({ type: "and", conditions })),
	count: vi.fn(() => ({ type: "count" })),
	eq: vi.fn((column, value) => ({ type: "eq", column, value })),
	notLike: vi.fn((column, value) => ({ type: "notLike", column, value })),
}));

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
		select.mockReturnValue({ from: selectFrom });
		selectFrom.mockReturnValue({ innerJoin: selectInnerJoin, where: selectWhere });
		selectInnerJoin.mockReturnValue({ where: selectWhere });
		selectWhere.mockResolvedValue([{ count: 1 }]);
	});

	it("counts only approved non-demo organization members", async () => {
		const seatCases = [
			{ status: "approved", email: "employee@example.com", billable: true },
			{ status: "pending", email: "pending@example.com", billable: false },
			{ status: "approved", email: "employee@demo.invalid", billable: false },
		];
		selectWhere.mockResolvedValueOnce([
			{ count: seatCases.filter(({ billable }) => billable).length },
		]);

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const seatSyncService = yield* SeatSyncService;

				return yield* seatSyncService.getCurrentSeatCount("org_123");
			}).pipe(Effect.provide(SeatSyncServiceLive), Effect.provide(appLayer)),
		);

		expect(result).toBe(1);
		expect(selectFrom).toHaveBeenCalledWith(member);
		expect(selectInnerJoin).toHaveBeenCalledWith(user, {
			type: "eq",
			column: user.id,
			value: member.userId,
		});
		expect(selectWhere).toHaveBeenCalledWith({
			type: "and",
			conditions: [
				{ type: "eq", column: member.organizationId, value: "org_123" },
				{ type: "eq", column: member.status, value: "approved" },
				{ type: "notLike", column: user.email, value: "%@demo.invalid" },
			],
		});
	});
});

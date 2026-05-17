import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { subscription } from "@/db/schema";
import { SubscriptionService, SubscriptionServiceLive } from "./subscription.service";

const { findFirst, insertValues, setValues, updateWhere } = vi.hoisted(() => ({
	findFirst: vi.fn(),
	insertValues: vi.fn(),
	setValues: vi.fn(),
	updateWhere: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			subscription: {
				findFirst,
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

describe("SubscriptionService", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		findFirst.mockResolvedValue({
			organizationId: "org_123",
			stripeCustomerId: "cus_test_123",
			status: "incomplete",
		});
		insertValues.mockResolvedValue(undefined);
		updateWhere.mockResolvedValue(undefined);
		setValues.mockReturnValue({ where: updateWhere });
	});

	it("updates an existing placeholder subscription row when creating from checkout", async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const subscriptionService = yield* SubscriptionService;

				yield* subscriptionService.create({
					organizationId: "org_123",
					stripeCustomerId: "cus_test_123",
					stripeSubscriptionId: "sub_test_123",
					stripePriceId: "price_monthly_123",
					status: "trialing",
					billingInterval: "month",
					trialEnd: new Date("2026-06-01T00:00:00.000Z"),
					currentPeriodStart: new Date("2026-05-18T00:00:00.000Z"),
					currentPeriodEnd: new Date("2026-06-18T00:00:00.000Z"),
					seats: 5,
				});
			}).pipe(Effect.provide(SubscriptionServiceLive)),
		);

		expect(setValues).toHaveBeenCalledWith(
			expect.objectContaining({
				stripeSubscriptionId: "sub_test_123",
				stripePriceId: "price_monthly_123",
				status: "trialing",
				billingInterval: "month",
				currentSeats: 5,
			}),
		);
		expect(updateWhere).toHaveBeenCalledWith({
			column: subscription.organizationId,
			value: "org_123",
		});
		expect(insertValues).not.toHaveBeenCalled();
	});
});

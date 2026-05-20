import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { subscription } from "@/db/schema";
import { SubscriptionService, SubscriptionServiceLive } from "./subscription.service";

const { findFirst, insertValues, onConflictDoNothing, returning, setValues, updateWhere } = vi.hoisted(() => ({
	findFirst: vi.fn(),
	insertValues: vi.fn(),
	onConflictDoNothing: vi.fn(),
	returning: vi.fn(),
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
	const existingSubscriptionRow = {
		id: "sub_row_123",
		organizationId: "org_123",
		stripeCustomerId: "cus_test_123",
		stripeSubscriptionId: null,
		stripePriceId: null,
		status: "incomplete",
		currentSeats: 0,
		trialStart: null,
		trialEnd: null,
		currentPeriodStart: null,
		currentPeriodEnd: null,
		billingInterval: null,
		cancelAt: null,
		canceledAt: null,
		lastSeatReportedAt: null,
		createdAt: new Date("2026-05-01T00:00:00.000Z"),
		updatedAt: new Date("2026-05-01T00:00:00.000Z"),
	};

	beforeEach(() => {
		vi.clearAllMocks();
		findFirst.mockResolvedValue(existingSubscriptionRow);
		insertValues.mockResolvedValue(undefined);
		onConflictDoNothing.mockReturnValue({ returning });
		returning.mockResolvedValue([]);
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

	it("creates a local trial without a Stripe customer", async () => {
		const now = new Date("2026-05-20T10:00:00.000Z");
		const trialEnd = new Date("2026-06-03T10:00:00.000Z");
		const localTrialRow = {
			...existingSubscriptionRow,
			id: "sub_local_trial_123",
			stripeCustomerId: null,
			status: "trialing",
			trialStart: now,
			trialEnd,
		};

		findFirst.mockResolvedValueOnce(null);
		insertValues.mockReturnValueOnce({ onConflictDoNothing });
		returning.mockResolvedValueOnce([localTrialRow]);

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const subscriptionService = yield* SubscriptionService;

				return yield* subscriptionService.ensureLocalTrial({
					organizationId: "org_123",
					now,
				});
			}).pipe(Effect.provide(SubscriptionServiceLive)),
		);

		expect(insertValues).toHaveBeenCalledWith({
			organizationId: "org_123",
			stripeCustomerId: null,
			status: "trialing",
			trialStart: now,
			trialEnd,
			currentSeats: 0,
		});
		expect(onConflictDoNothing).toHaveBeenCalledWith({
			target: subscription.organizationId,
		});
		expect(result).toMatchObject({
			id: "sub_local_trial_123",
			organizationId: "org_123",
			stripeCustomerId: null,
			status: "trialing",
			trialStart: now,
			trialEnd,
			currentSeats: 0,
			isTrialing: true,
			isActive: true,
		});
	});

	it("does not replace an existing billing row when ensuring a local trial", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const subscriptionService = yield* SubscriptionService;

				return yield* subscriptionService.ensureLocalTrial({
					organizationId: "org_123",
					now: new Date("2026-05-20T10:00:00.000Z"),
				});
			}).pipe(Effect.provide(SubscriptionServiceLive)),
		);

		expect(result).toMatchObject({
			id: "sub_row_123",
			organizationId: "org_123",
			stripeCustomerId: "cus_test_123",
			status: "incomplete",
			trialStart: null,
		});
		expect(insertValues).not.toHaveBeenCalled();
	});

	it("returns the raced row when local trial insert loses a conflict", async () => {
		const now = new Date("2026-05-20T10:00:00.000Z");
		const racedRow = {
			...existingSubscriptionRow,
			id: "sub_raced_trial_123",
			stripeCustomerId: null,
			status: "trialing",
			trialStart: now,
			trialEnd: new Date("2026-06-03T10:00:00.000Z"),
		};

		findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(racedRow);
		insertValues.mockReturnValueOnce({ onConflictDoNothing });
		returning.mockResolvedValueOnce([]);

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const subscriptionService = yield* SubscriptionService;

				return yield* subscriptionService.ensureLocalTrial({
					organizationId: "org_123",
					now,
				});
			}).pipe(Effect.provide(SubscriptionServiceLive)),
		);

		expect(result).toMatchObject({
			id: "sub_raced_trial_123",
			stripeCustomerId: null,
			trialStart: now,
		});
	});
});

import { Effect } from "effect";
import { Settings } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { member, user } from "@/db/auth-schema";
import { subscription } from "@/db/schema";
import { env } from "@/env";
import { SubscriptionService, SubscriptionServiceLive } from "./subscription.service";

const {
	findFirst,
	insertValues,
	onConflictDoNothing,
	onConflictDoUpdate,
	returning,
	setValues,
	updateWhere,
	select,
	selectFrom,
	selectInnerJoin,
	selectWhere,
	andMock,
	eqMock,
	notLikeMock,
} = vi.hoisted(() => ({
	findFirst: vi.fn(),
	insertValues: vi.fn(),
	onConflictDoNothing: vi.fn(),
	onConflictDoUpdate: vi.fn(),
	returning: vi.fn(),
	setValues: vi.fn(),
	updateWhere: vi.fn(),
	select: vi.fn(),
	selectFrom: vi.fn(),
	selectInnerJoin: vi.fn(),
	selectWhere: vi.fn(),
	andMock: vi.fn((...conditions) => ({ type: "and", conditions })),
	eqMock: vi.fn((column, value) => ({ type: "eq", column, value })),
	notLikeMock: vi.fn((column, value) => ({ type: "notLike", column, value })),
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
		select,
	},
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
	...(await importOriginal<typeof import("drizzle-orm")>()),
	and: andMock,
	eq: eqMock,
	notLike: notLikeMock,
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
		onConflictDoUpdate.mockResolvedValue(undefined);
		returning.mockResolvedValue([]);
		updateWhere.mockResolvedValue(undefined);
		setValues.mockReturnValue({ where: updateWhere });
		select.mockReturnValue({ from: selectFrom });
		selectFrom.mockReturnValue({ innerJoin: selectInnerJoin, where: selectWhere });
		selectInnerJoin.mockReturnValue({ where: selectWhere });
		selectWhere.mockResolvedValue([{ count: 3 }]);
		(env as { BILLING_ENABLED: "true" | "false" }).BILLING_ENABLED = "false";
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
		expect(updateWhere).toHaveBeenCalledWith(expect.objectContaining({
			column: subscription.organizationId,
			value: "org_123",
		}));
		expect(insertValues).not.toHaveBeenCalled();
	});

	it("returns current billable organization seats instead of stale stored seats", async () => {
		findFirst.mockResolvedValueOnce({
			...existingSubscriptionRow,
			status: "trialing",
			currentSeats: 0,
		});
		selectWhere.mockResolvedValueOnce([{ count: 3 }]);

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const subscriptionService = yield* SubscriptionService;

				return yield* subscriptionService.getByOrganization("org_123");
			}).pipe(Effect.provide(SubscriptionServiceLive)),
		);

		expect(result).toMatchObject({
			organizationId: "org_123",
			currentSeats: 3,
		});
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

	it("creates a local trial without a Stripe customer using current organization seats", async () => {
		const now = new Date("2026-05-20T10:00:00.000Z");
		const trialEnd = new Date("2026-06-03T10:00:00.000Z");
		const localTrialRow = {
			...existingSubscriptionRow,
			id: "sub_local_trial_123",
			stripeCustomerId: null,
			status: "trialing",
			trialStart: now,
			trialEnd,
			currentSeats: 3,
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
			currentSeats: 3,
		});
		expect(selectFrom).toHaveBeenCalledWith(member);
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
			currentSeats: 3,
			isTrialing: true,
			isActive: true,
		});
	});

	it("calculates local trial end as exactly fourteen UTC days across DST", async () => {
		const previousZone = Settings.defaultZone;
		Settings.defaultZone = "America/New_York";
		const now = new Date("2026-03-01T10:00:00.000Z");
		const expectedTrialEnd = new Date("2026-03-15T10:00:00.000Z");
		const localTrialRow = {
			...existingSubscriptionRow,
			id: "sub_dst_trial_123",
			stripeCustomerId: null,
			status: "trialing",
			trialStart: now,
			trialEnd: expectedTrialEnd,
		};

		findFirst.mockResolvedValueOnce(null);
		insertValues.mockReturnValueOnce({ onConflictDoNothing });
		returning.mockResolvedValueOnce([localTrialRow]);

		try {
			await Effect.runPromise(
				Effect.gen(function* () {
					const subscriptionService = yield* SubscriptionService;

					return yield* subscriptionService.ensureLocalTrial({
						organizationId: "org_123",
						now,
					});
				}).pipe(Effect.provide(SubscriptionServiceLive)),
			);

			const insertedTrialEnd = insertValues.mock.calls[0]?.[0]?.trialEnd;
			expect(insertedTrialEnd).toBeInstanceOf(Date);
			expect(insertedTrialEnd.getTime() - now.getTime()).toBe(14 * 24 * 60 * 60 * 1000);
			expect(insertedTrialEnd.toISOString()).toBe("2026-03-15T10:00:00.000Z");
		} finally {
			Settings.defaultZone = previousZone;
		}
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

	it("returns false for an expired trialing row when checking mutation access", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-06-04T10:00:00.000Z"));
		(env as { BILLING_ENABLED: "true" | "false" }).BILLING_ENABLED = "true";
		findFirst.mockResolvedValueOnce({
			...existingSubscriptionRow,
			status: "trialing",
			trialEnd: new Date("2026-06-03T10:00:00.000Z"),
		});

		try {
			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const subscriptionService = yield* SubscriptionService;

					return yield* subscriptionService.canMutateData("org_123");
				}).pipe(Effect.provide(SubscriptionServiceLive)),
			);

			expect(result).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it("returns false for a trialing row that ends exactly now when checking mutation access", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-06-03T10:00:00.000Z"));
		(env as { BILLING_ENABLED: "true" | "false" }).BILLING_ENABLED = "true";
		findFirst.mockResolvedValueOnce({
			...existingSubscriptionRow,
			status: "trialing",
			trialEnd: new Date("2026-06-03T10:00:00.000Z"),
		});

		try {
			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const subscriptionService = yield* SubscriptionService;

					return yield* subscriptionService.canMutateData("org_123");
				}).pipe(Effect.provide(SubscriptionServiceLive)),
			);

			expect(result).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it("returns true for an unexpired trialing row when checking mutation access", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-06-03T09:59:59.999Z"));
		(env as { BILLING_ENABLED: "true" | "false" }).BILLING_ENABLED = "true";
		findFirst.mockResolvedValueOnce({
			...existingSubscriptionRow,
			status: "trialing",
			trialEnd: new Date("2026-06-03T10:00:00.000Z"),
		});

		try {
			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const subscriptionService = yield* SubscriptionService;

					return yield* subscriptionService.canMutateData("org_123");
				}).pipe(Effect.provide(SubscriptionServiceLive)),
			);

			expect(result).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it.each([
		"incomplete",
		"paused",
		"unknown_status",
	])("returns false for %s status when checking mutation access", async (status) => {
		(env as { BILLING_ENABLED: "true" | "false" }).BILLING_ENABLED = "true";
		findFirst.mockResolvedValueOnce({
			...existingSubscriptionRow,
			status,
		});

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const subscriptionService = yield* SubscriptionService;

				return yield* subscriptionService.canMutateData("org_123");
			}).pipe(Effect.provide(SubscriptionServiceLive)),
		);

		expect(result).toBe(false);
	});

	it("sets Stripe customer ID with conflict-safe insert update", async () => {
		insertValues.mockReturnValueOnce({ onConflictDoUpdate });

		await Effect.runPromise(
			Effect.gen(function* () {
				const subscriptionService = yield* SubscriptionService;

				yield* subscriptionService.setStripeCustomerId("org_123", "cus_test_123");
			}).pipe(Effect.provide(SubscriptionServiceLive)),
		);

		expect(findFirst).not.toHaveBeenCalled();
		expect(insertValues).toHaveBeenCalledWith({
			organizationId: "org_123",
			stripeCustomerId: "cus_test_123",
			status: "incomplete",
			currentSeats: 0,
		});
		expect(onConflictDoUpdate).toHaveBeenCalledWith({
			target: subscription.organizationId,
			set: expect.objectContaining({
				stripeCustomerId: "cus_test_123",
				updatedAt: expect.any(Date),
			}),
		});
	});
});

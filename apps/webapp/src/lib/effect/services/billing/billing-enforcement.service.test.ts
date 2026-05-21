import { Effect } from "effect";
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { subscription } from "@/db/schema";
import { member } from "@/db/auth-schema";
import {
	type BillingAccessResult,
	BillingEnforcementService,
	BillingEnforcementServiceLive,
} from "./billing-enforcement.service";

const { findFirst, insertValues, onConflictDoNothing, returning, select, selectFrom, selectWhere } = vi.hoisted(() => ({
	findFirst: vi.fn(),
	insertValues: vi.fn(),
	onConflictDoNothing: vi.fn(),
	returning: vi.fn(),
	select: vi.fn(),
	selectFrom: vi.fn(),
	selectWhere: vi.fn(),
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
		select,
	},
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
	...(await importOriginal<typeof import("drizzle-orm")>()),
	eq: vi.fn((column, value) => ({ column, value })),
}));

describe("BillingEnforcementService", () => {
	it("exports BillingAccessResult from the service module", () => {
		expectTypeOf<BillingAccessResult>().toMatchTypeOf<{
			canAccess: boolean;
		}>();
	});

	const now = new Date("2026-05-20T10:00:00.000Z");
	const trialEnd = new Date("2026-06-03T10:00:00.000Z");
	const subscriptionRow = {
		id: "sub_row_123",
		organizationId: "org_123",
		stripeCustomerId: null,
		stripeSubscriptionId: null,
		stripePriceId: null,
		status: "trialing",
		currentSeats: 0,
		trialStart: now,
		trialEnd,
		currentPeriodStart: null,
		currentPeriodEnd: null,
		billingInterval: null,
		cancelAt: null,
		canceledAt: null,
		lastSeatReportedAt: null,
		createdAt: now,
		updatedAt: now,
	};

	beforeEach(() => {
		vi.useRealTimers();
		vi.resetAllMocks();
		process.env.BILLING_ENABLED = "true";
		findFirst.mockResolvedValue(subscriptionRow);
		insertValues.mockReturnValue({ onConflictDoNothing });
		onConflictDoNothing.mockReturnValue({ returning });
		returning.mockResolvedValue([]);
		select.mockReturnValue({ from: selectFrom });
		selectFrom.mockReturnValue({ where: selectWhere });
		selectWhere.mockResolvedValue([{ count: 3 }]);
	});

	it("creates a local trial lazily with current organization seats when billing is enabled and no row exists", async () => {
		findFirst.mockResolvedValueOnce(null);
		returning.mockResolvedValueOnce([subscriptionRow]);

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const enforcementService = yield* BillingEnforcementService;

				return yield* enforcementService.checkBillingAccess("org_123", { now });
			}).pipe(Effect.provide(BillingEnforcementServiceLive)),
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
			canAccess: true,
			state: "trialing",
			status: "trialing",
			trialEndsAt: trialEnd,
		});
	});

	it("does not create a trial when billing is disabled", async () => {
		process.env.BILLING_ENABLED = "false";
		findFirst.mockResolvedValueOnce(null);

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const enforcementService = yield* BillingEnforcementService;

				return yield* enforcementService.checkBillingAccess("org_123", { now });
			}).pipe(Effect.provide(BillingEnforcementServiceLive)),
		);

		expect(result).toEqual({ canAccess: true, state: "disabled" });
		expect(findFirst).not.toHaveBeenCalled();
		expect(insertValues).not.toHaveBeenCalled();
	});

	it("does not insert when local trial creation is disabled", async () => {
		findFirst.mockResolvedValueOnce(null);

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const enforcementService = yield* BillingEnforcementService;

				return yield* enforcementService.checkBillingAccess("org_123", {
					now,
					createTrialIfMissing: false,
				});
			}).pipe(Effect.provide(BillingEnforcementServiceLive)),
		);

		expect(result).toEqual({
			canAccess: false,
			state: "suspended",
			reason: "subscription_required",
		});
		expect(insertValues).not.toHaveBeenCalled();
	});

	it("fails requireActiveSubscription for a canceled organization", async () => {
		findFirst.mockResolvedValueOnce({
			...subscriptionRow,
			status: "canceled",
			trialEnd: null,
		});

		const error = await Effect.runPromise(
			Effect.gen(function* () {
				const enforcementService = yield* BillingEnforcementService;

				return yield* enforcementService.requireActiveSubscription("org_123").pipe(Effect.flip);
			}).pipe(Effect.provide(BillingEnforcementServiceLive)),
		);

		expect(error).toMatchObject({
			_tag: "BillingError",
			reason: "canceled",
		});
	});

	it("fails expired trials with trial_expired", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(now);
		findFirst.mockResolvedValueOnce({
			...subscriptionRow,
			trialEnd: now,
		});

		const error = await Effect.runPromise(
			Effect.gen(function* () {
				const enforcementService = yield* BillingEnforcementService;

				return yield* enforcementService.requireActiveSubscription("org_123").pipe(Effect.flip);
			}).pipe(Effect.provide(BillingEnforcementServiceLive)),
		);

		expect(error).toMatchObject({
			_tag: "BillingError",
			reason: "trial_expired",
		});
	});
});

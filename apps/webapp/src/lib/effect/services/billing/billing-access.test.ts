import { describe, expect, it } from "vitest";

import { evaluateBillingAccess, getDaysRemaining } from "./billing-access";

const now = new Date("2026-05-20T12:00:00.000Z");

describe("evaluateBillingAccess", () => {
	it("allows access when billing is disabled", () => {
		expect(
			evaluateBillingAccess({
				billingEnabled: false,
				subscription: null,
				now,
			}),
		).toEqual({
			canAccess: true,
			state: "disabled",
		});
	});

	it("allows a valid trial and returns trial metadata", () => {
		const trialEnd = new Date("2026-05-23T00:00:00.000Z");

		expect(
			evaluateBillingAccess({
				billingEnabled: true,
				subscription: {
					status: "trialing",
					trialEnd,
					cancelAt: null,
				},
				now,
			}),
		).toEqual({
			canAccess: true,
			state: "trialing",
			trialEndsAt: trialEnd,
			status: "trialing",
			daysRemaining: 3,
		});
	});

	it("suspends expired and missing trials", () => {
		const expiredTrial = evaluateBillingAccess({
			billingEnabled: true,
			subscription: {
				status: "trialing",
				trialEnd: new Date("2026-05-20T12:00:00.000Z"),
				cancelAt: null,
			},
			now,
		});
		const missingTrialEnd = evaluateBillingAccess({
			billingEnabled: true,
			subscription: {
				status: "trialing",
				trialEnd: null,
				cancelAt: null,
			},
			now,
		});

		expect(expiredTrial).toEqual({
			canAccess: false,
			state: "suspended",
			reason: "trial_expired",
			status: "trialing",
			trialEndsAt: new Date("2026-05-20T12:00:00.000Z"),
		});
		expect(missingTrialEnd).toEqual({
			canAccess: false,
			state: "suspended",
			reason: "trial_expired",
			status: "trialing",
			trialEndsAt: null,
		});
	});

	it("allows active subscriptions with scheduled cancellation", () => {
		expect(
			evaluateBillingAccess({
				billingEnabled: true,
				subscription: {
					status: "active",
					trialEnd: null,
					cancelAt: new Date("2026-06-01T00:00:00.000Z"),
				},
				now,
			}),
		).toEqual({
			canAccess: true,
			state: "active",
			status: "active",
		});
	});

	it("suspends blocked statuses with their expected reasons", () => {
		expect(
			evaluateBillingAccess({
				billingEnabled: true,
				subscription: { status: "past_due", trialEnd: null, cancelAt: null },
				now,
			}),
		).toEqual({
			canAccess: false,
			state: "suspended",
			reason: "payment_failed",
			status: "past_due",
		});
		expect(
			evaluateBillingAccess({
				billingEnabled: true,
				subscription: { status: "canceled", trialEnd: null, cancelAt: null },
				now,
			}),
		).toEqual({
			canAccess: false,
			state: "suspended",
			reason: "canceled",
			status: "canceled",
		});
		expect(
			evaluateBillingAccess({
				billingEnabled: true,
				subscription: { status: "unpaid", trialEnd: null, cancelAt: null },
				now,
			}),
		).toEqual({
			canAccess: false,
			state: "suspended",
			reason: "canceled",
			status: "unpaid",
		});
		for (const status of ["incomplete", "incomplete_expired", "paused", "unknown_status"]) {
			expect(
				evaluateBillingAccess({
					billingEnabled: true,
					subscription: { status, trialEnd: null, cancelAt: null },
					now,
				}),
			).toEqual({
				canAccess: false,
				state: "suspended",
				reason: "subscription_required",
				status,
			});
		}
	});

	it("suspends when billing is enabled without a subscription row", () => {
		expect(
			evaluateBillingAccess({
				billingEnabled: true,
				subscription: null,
				now,
			}),
		).toEqual({
			canAccess: false,
			state: "suspended",
			reason: "subscription_required",
		});
	});
});

describe("getDaysRemaining", () => {
	it("returns ceil days remaining", () => {
		expect(getDaysRemaining(new Date("2026-05-20T12:00:01.000Z"), now)).toBe(1);
		expect(getDaysRemaining(new Date("2026-05-23T00:00:00.000Z"), now)).toBe(3);
	});
});

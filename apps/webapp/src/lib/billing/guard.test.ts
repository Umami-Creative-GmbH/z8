import { describe, expect, it } from "vitest";
import {
	createBillingForbiddenResponse,
	isBillingMutationAllowed,
	requireBillingForMutation,
} from "./guard";

describe("billing mutation guard", () => {
	it("allows mutations when billing access allows access", () => {
		expect(isBillingMutationAllowed({ canAccess: true })).toBe(true);
	});

	it("blocks mutations when billing access denies access", () => {
		expect(
			isBillingMutationAllowed({
				canAccess: false,
				reason: "trial_expired",
			}),
		).toBe(false);
	});

	it("returns a 402 billing-required response with the access reason", async () => {
		const response = createBillingForbiddenResponse({
			canAccess: false,
			reason: "trial_expired",
		});

		expect(response.status).toBe(402);
		expect(await response.json()).toEqual({
			error: "billing_required",
			reason: "trial_expired",
		});
	});

	it("defaults the forbidden response reason to subscription_required", async () => {
		const response = createBillingForbiddenResponse({ canAccess: false });

		expect(response.status).toBe(402);
		expect(await response.json()).toEqual({
			error: "billing_required",
			reason: "subscription_required",
		});
	});

	it("checks billing access for mutations", async () => {
		const originalBillingEnabled = process.env.BILLING_ENABLED;
		process.env.BILLING_ENABLED = "false";

		try {
			await expect(requireBillingForMutation("org-1")).resolves.toMatchObject({
				canAccess: true,
			});
		} finally {
			if (originalBillingEnabled === undefined) {
				delete process.env.BILLING_ENABLED;
			} else {
				process.env.BILLING_ENABLED = originalBillingEnabled;
			}
		}
	});
});

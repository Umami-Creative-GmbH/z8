import { describe, expect, it } from "vitest";

import { subscription } from "@/db/schema/billing";

describe("billing schema", () => {
	it("allows local trial rows without a Stripe customer", () => {
		const trialRow: typeof subscription.$inferInsert = {
			organizationId: "org_123",
			status: "trialing",
			trialStart: new Date("2026-05-20T00:00:00.000Z"),
			trialEnd: new Date("2026-06-03T00:00:00.000Z"),
			currentSeats: 0,
		};

		expect(trialRow.stripeCustomerId).toBeUndefined();
		expect(trialRow.status).toBe("trialing");
	});
});

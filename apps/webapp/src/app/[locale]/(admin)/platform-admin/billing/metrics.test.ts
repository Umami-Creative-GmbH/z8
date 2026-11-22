import { describe, expect, it } from "vitest";
import { computeTrialConversionRate } from "./metrics";

describe("computeTrialConversionRate", () => {
	it("returns 0 when there are no subscriptions", () => {
		expect(computeTrialConversionRate([])).toBe(0);
	});

	it("includes canceled and unpaid trials in the denominator instead of only trialing + active", () => {
		expect(
			computeTrialConversionRate([
				{ status: "active" },
				{ status: "trialing" },
				{ status: "canceled" },
				{ status: "unpaid" },
			]),
		).toBe(25);
	});

	it("returns 100 when every subscription is active", () => {
		expect(computeTrialConversionRate([{ status: "active" }, { status: "active" }])).toBe(100);
	});
});

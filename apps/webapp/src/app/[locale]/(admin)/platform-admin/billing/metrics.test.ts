import { describe, expect, it } from "vitest";
import { computeTrialConversionRate } from "./metrics";

const NOW = new Date("2026-06-01T00:00:00.000Z");
const PAST_TRIAL_END = new Date("2026-05-15T00:00:00.000Z");
const FUTURE_TRIAL_END = new Date("2026-06-15T00:00:00.000Z");

describe("computeTrialConversionRate", () => {
	it("returns 0 when there are no resolved trials", () => {
		expect(computeTrialConversionRate([], NOW)).toBe(0);
		expect(
			computeTrialConversionRate(
				[
					{ status: "trialing", trialEnd: FUTURE_TRIAL_END },
					{ status: "active", trialEnd: null },
				],
				NOW,
			),
		).toBe(0);
	});

	it("excludes in-progress trials and counts expired or canceled trials in the denominator", () => {
		expect(
			computeTrialConversionRate(
				[
					{ status: "active", trialEnd: PAST_TRIAL_END },
					{ status: "trialing", trialEnd: FUTURE_TRIAL_END }, // still running -> excluded
					{ status: "trialing", trialEnd: PAST_TRIAL_END }, // expired trial -> not converted
					{ status: "canceled", trialEnd: PAST_TRIAL_END }, // canceled trial -> not converted
				],
				NOW,
			),
		).toBe(33);
	});

	it("counts early upgrades and past_due trials as converted", () => {
		expect(
			computeTrialConversionRate(
				[
					{ status: "active", trialEnd: FUTURE_TRIAL_END },
					{ status: "past_due", trialEnd: PAST_TRIAL_END },
					{ status: "canceled", trialEnd: FUTURE_TRIAL_END },
					{ status: "unpaid", trialEnd: PAST_TRIAL_END },
				],
				NOW,
			),
		).toBe(50);
	});
});

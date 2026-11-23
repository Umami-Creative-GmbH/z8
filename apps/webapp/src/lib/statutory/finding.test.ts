import { describe, expect, it } from "vitest";
import { classifyStatutoryUsage, statutoryFindingId } from "./finding";

const tiers = { warningThresholdPercent: 80, criticalThresholdPercent: 95 };

describe("classifyStatutoryUsage", () => {
	it.each([
		[0, 70, "ok", 0],
		[55, 70, "ok", 78],
		[56, 70, "warning", 80],
		[66, 70, "warning", 94],
		[67, 70, "critical", 95],
		[70, 70, "critical", 100],
		[71, 70, "exceeded", 101],
	] as const)("%i of %i is %s (%i %%)", (used, limit, tier, usedPercent) => {
		expect(classifyStatutoryUsage({ used, limit }, tiers)).toEqual({ tier, usedPercent });
	});

	it("uses the organization's own tiers", () => {
		expect(
			classifyStatutoryUsage(
				{ used: 13, limit: 26 },
				{ warningThresholdPercent: 50, criticalThresholdPercent: 90 },
			).tier,
		).toBe("warning");
	});

	it("treats any use of a zero limit as exceeded", () => {
		expect(classifyStatutoryUsage({ used: 1, limit: 0 }, tiers).tier).toBe("exceeded");
		expect(classifyStatutoryUsage({ used: 0, limit: 0 }, tiers).tier).toBe("ok");
	});
});

describe("statutoryFindingId", () => {
	it("identifies a finding by kind, employee and subject", () => {
		expect(statutoryFindingId("minijob_monthly_cap", "emp-1", "2026-03")).toBe(
			"minijob_monthly_cap:emp-1:2026-03",
		);
	});
});

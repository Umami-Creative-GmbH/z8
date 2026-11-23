import { describe, expect, it } from "vitest";
import type { ComplianceFinding } from "@/lib/scheduling/compliance/types";
import { withoutExecutiveExemptFindings } from "./executive-exempt";

const overtime = (
	period: "daily" | "weekly" | "monthly",
	periodKey: string,
): ComplianceFinding => ({
	type: "overtime",
	employeeId: "employee-1",
	period,
	periodKey,
	totalMinutes: 3000,
	thresholdMinutes: 2400,
});

describe("withoutExecutiveExemptFindings", () => {
	it("drops weekly and monthly overtime only for periods that contain an exempt day", () => {
		// Exempt from Thursday 5 March 2026 on (a mid-month switch to executive terms).
		const exempt = new Map([["employee-1", new Set(["2026-03-05", "2026-03-06"])]]);
		const findings = [
			overtime("weekly", "2026-02-23"),
			overtime("weekly", "2026-03-02"),
			overtime("monthly", "2026-02"),
			overtime("monthly", "2026-03"),
			overtime("daily", "2026-03-04"),
			overtime("daily", "2026-03-05"),
		];
		expect(withoutExecutiveExemptFindings(findings, exempt, "Europe/Berlin")).toEqual([
			overtime("weekly", "2026-02-23"),
			overtime("monthly", "2026-02"),
			overtime("daily", "2026-03-04"),
		]);
	});
});

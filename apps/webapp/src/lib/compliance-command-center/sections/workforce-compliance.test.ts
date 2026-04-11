import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { deriveWorkforceComplianceSection } from "./workforce-compliance";

describe("deriveWorkforceComplianceSection", () => {
	it("marks the section critical when rest-period or max-hours violations exist", () => {
		const result = deriveWorkforceComplianceSection({
			restPeriodViolations: 1,
			maxDailyHourViolations: 0,
			overtimeViolations: 2,
			pendingExceptions: 0,
			latestViolationAt: DateTime.utc().minus({ hours: 2 }).toISO(),
		});

		expect(result.card.status).toBe("critical");
		expect(result.card.facts).toContain("Rest-period violations: 1");
	});

	it("falls back to warning for overtime-only drift", () => {
		const result = deriveWorkforceComplianceSection({
			restPeriodViolations: 0,
			maxDailyHourViolations: 0,
			overtimeViolations: 3,
			pendingExceptions: 1,
			latestViolationAt: DateTime.utc().minus({ days: 1 }).toISO(),
		});

		expect(result.card.status).toBe("warning");
	});
});

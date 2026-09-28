import { describe, expect, it, vi } from "vitest";
import { localDayRange, localWeekRange } from "@/lib/datetime/temporal-boundaries";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { type ComplianceTotalsPeriod, complianceTotalsOf } from "./compliance-totals";

vi.mock("@/db", () => ({ db: {} }));

function period(start: string, end: string | null, durationMinutes: number | null) {
	return {
		start: parseInstant(start),
		end: end ? parseInstant(end) : null,
		durationMinutes,
	} satisfies ComplianceTotalsPeriod;
}

// Wednesday 2026-09-23 in New York (UTC-4); its Sunday week starts on the 20th.
const zone = "America/New_York";
const ranges = {
	day: localDayRange("2026-09-23", zone),
	week: localWeekRange("2026-09-23", zone, "sunday"),
};

describe("complianceTotalsOf", () => {
	it("totals the local day and week in the work's zone, not in UTC", () => {
		const totals = complianceTotalsOf(
			[
				// 23:00 on the 22nd in New York, though the 23rd in UTC.
				period("2026-09-23T03:00:00Z", "2026-09-23T03:30:00Z", 30),
				period("2026-09-23T12:00:00Z", "2026-09-23T16:00:00Z", 240),
				// 21:00 on the 23rd in New York, though the 24th in UTC.
				period("2026-09-24T01:00:00Z", "2026-09-24T02:00:00Z", 60),
				// Saturday the 19th in New York: the previous week.
				period("2026-09-19T14:00:00Z", "2026-09-19T22:00:00Z", 480),
			],
			ranges,
		);

		expect(totals).toMatchObject({ dailyMinutes: 300, weeklyMinutes: 330 });
	});

	it("counts gaps over a minute between the day's consecutive periods as breaks", () => {
		const totals = complianceTotalsOf(
			[
				period("2026-09-23T17:00:00Z", "2026-09-23T19:00:00Z", 120),
				period("2026-09-23T12:00:00Z", "2026-09-23T16:00:00Z", 240),
				// One minute is a handover, not a break.
				period("2026-09-23T19:01:00Z", "2026-09-23T20:00:00Z", 59),
			],
			ranges,
		);

		expect(totals).toEqual({ dailyMinutes: 419, weeklyMinutes: 419, breakMinutes: 60 });
	});

	it("ignores a running period's missing end and duration", () => {
		const totals = complianceTotalsOf(
			[
				period("2026-09-23T12:00:00Z", null, null),
				period("2026-09-23T14:00:00Z", "2026-09-23T15:00:00Z", 60),
			],
			ranges,
		);

		expect(totals).toEqual({ dailyMinutes: 60, weeklyMinutes: 60, breakMinutes: 0 });
	});
});

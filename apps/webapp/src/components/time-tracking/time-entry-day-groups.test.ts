import { describe, expect, it } from "vitest";
import type { WorkPeriodData } from "./time-entries-table-columns";
import { timeEntryDayGroups } from "./time-entry-day-groups";

function period(
	id: string,
	start: string,
	durationMinutes: number | null,
): WorkPeriodData {
	return {
		id,
		startTime: new Date(start),
		endTime: durationMinutes === null ? null : new Date("2026-11-14T04:00:00Z"),
		durationMinutes,
		approvalStatus: "approved",
		approvalRequestId: null,
		workLocationType: "remote",
		workCategoryId: null,
		clockIn: {
			id: `${id}-in`,
			utcOffsetMinutes: -300,
			isSuperseded: false,
			notes: null,
		},
		clockOut: {
			id: `${id}-out`,
			utcOffsetMinutes: 60,
			isSuperseded: false,
			notes: "Travel",
		},
	};
}

describe("time entry day groups", () => {
	it("groups by the employee's calendar day independently of captured endpoint offsets", () => {
		const travel = period("travel", "2026-11-13T23:30:00Z", 270);
		const [berlin] = timeEntryDayGroups([travel], "Europe/Berlin");
		const [newYork] = timeEntryDayGroups([travel], "America/New_York");
		expect(berlin.date).toBe("2026-11-14");
		expect(newYork.date).toBe("2026-11-13");
		expect(berlin.durationMinutes).toBe(270);
		expect(berlin.periods[0]).toBe(travel);
		expect(travel.clockIn.utcOffsetMinutes).toBe(-300);
		expect(travel.clockOut?.utcOffsetMinutes).toBe(60);
	});

	it("retains every record, including more than one old table page", () => {
		const periods = Array.from({ length: 15 }, (_, index) =>
			period(String(index), "2026-11-13T08:00:00Z", 20),
		);
		const [group] = timeEntryDayGroups(periods, "UTC");
		expect(group.periods).toHaveLength(15);
		expect(group.durationMinutes).toBe(300);
	});

	it("distinguishes incomplete work from a completed zero-duration record and keeps newest days first", () => {
		const groups = timeEntryDayGroups(
			[
				period("older", "2026-11-12T08:00:00Z", 0),
				period("active", "2026-11-13T08:00:00Z", null),
			],
			"UTC",
		);
		expect(
			groups.map((group) => [
				group.date,
				group.durationMinutes,
				group.incomplete,
			]),
		).toEqual([
			["2026-11-13", 0, true],
			["2026-11-12", 0, false],
		]);
	});
});

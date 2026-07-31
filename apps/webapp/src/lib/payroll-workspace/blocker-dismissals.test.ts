import { describe, expect, it } from "vitest";
import { filterDismissedPayrollBlockers } from "./blocker-dismissals";
import type { PayrollBlocker } from "./types";

const blockers: PayrollBlocker[] = [
	{
		id: "source-1",
		employeeId: "employee-1",
		type: "missing_clock_out",
		label: "Missing clock-out",
		date: "2026-06-10",
		time: "09:00",
	},
	{
		id: "source-2",
		employeeId: "employee-2",
		type: "pending_absence",
		label: "Pending absence",
		date: "2026-06-11",
		time: null,
	},
];

describe("filterDismissedPayrollBlockers", () => {
	it("removes an exact blocker type and source ID match", () => {
		expect(
			filterDismissedPayrollBlockers(blockers, [
				{ blockerType: "missing_clock_out", sourceId: "source-1" },
			]),
		).toEqual([blockers[1]]);
	});

	it("returns all blockers unchanged when there are no dismissals", () => {
		expect(filterDismissedPayrollBlockers(blockers, [])).toEqual(blockers);
	});

	it("keeps the same source ID when the blocker type does not match", () => {
		expect(
			filterDismissedPayrollBlockers(blockers, [
				{ blockerType: "pending_absence", sourceId: "source-1" },
			]),
		).toEqual(blockers);
	});

	it("matches arbitrary source IDs without delimiter collisions", () => {
		const delimiterBlockers: PayrollBlocker[] = [
			{ ...blockers[0], id: "source::pending_absence::1" },
			{ ...blockers[1], id: "source::missing_clock_out::1" },
		];

		expect(
			filterDismissedPayrollBlockers(delimiterBlockers, [
				{
					blockerType: "missing_clock_out",
					sourceId: "source::pending_absence::1",
				},
			]),
		).toEqual([delimiterBlockers[1]]);
	});
});

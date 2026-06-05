import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { buildPayrollSummaryFromRows } from "./summary";

describe("buildPayrollSummaryFromRows", () => {
	it("returns total worked hours per employee", () => {
		const summary = buildPayrollSummaryFromRows({
			organizationName: "Acme GmbH",
			period: { start: "2026-06-01", end: "2026-06-30", label: "June 2026" },
			generatedAt: DateTime.fromISO("2026-06-30T12:00:00Z"),
			generatedBy: { id: "payroll-1", name: "Payroll User" },
			employees: [
				{
					id: "employee-1",
					name: "Ada Lovelace",
					employeeNumber: "E-1",
					teamName: "Ops",
					contractType: "hourly",
				},
			],
			workRows: [
				{ employeeId: "employee-1", durationMinutes: 120 },
				{ employeeId: "employee-1", durationMinutes: 45 },
			],
			absenceRows: [],
			blockers: [],
		});

		expect(summary.totals.totalWorkedHours).toBe(2.75);
		expect(summary.employees[0]?.workedHours).toBe(2.75);
	});

	it("groups absence days by employee and category", () => {
		const summary = buildPayrollSummaryFromRows({
			organizationName: "Acme GmbH",
			period: { start: "2026-06-01", end: "2026-06-30", label: "June 2026" },
			generatedAt: DateTime.fromISO("2026-06-30T12:00:00Z"),
			generatedBy: { id: "payroll-1", name: "Payroll User" },
			employees: [
				{
					id: "employee-1",
					name: "Ada Lovelace",
					employeeNumber: "E-1",
					teamName: "Ops",
					contractType: "fixed",
				},
			],
			workRows: [],
			absenceRows: [
				{ employeeId: "employee-1", categoryId: "vacation", categoryName: "Vacation", days: 2 },
				{ employeeId: "employee-1", categoryId: "sick", categoryName: "Sick", days: 1 },
			],
			blockers: [],
		});

		expect(summary.employees[0]?.absenceDaysByCategory).toEqual([
			{ categoryId: "sick", categoryName: "Sick", days: 1 },
			{ categoryId: "vacation", categoryName: "Vacation", days: 2 },
		]);
	});

	it("keeps blockers as warnings and marks affected employees", () => {
		const summary = buildPayrollSummaryFromRows({
			organizationName: "Acme GmbH",
			period: { start: "2026-06-01", end: "2026-06-30", label: "June 2026" },
			generatedAt: DateTime.fromISO("2026-06-30T12:00:00Z"),
			generatedBy: { id: "payroll-1", name: "Payroll User" },
			employees: [
				{
					id: "employee-1",
					name: "Ada Lovelace",
					employeeNumber: "E-1",
					teamName: "Ops",
					contractType: "hourly",
				},
			],
			workRows: [],
			absenceRows: [],
			blockers: [
				{
					id: "blocker-1",
					employeeId: "employee-1",
					type: "missing_clock_out",
					label: "Missing clock-out",
				},
			],
		});

		expect(summary.totals.blockerCount).toBe(1);
		expect(summary.employees[0]?.hasBlockers).toBe(true);
	});
});

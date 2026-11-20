import { DateTime } from "luxon";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { buildPayrollPeriodRead } from "./period-read";

describe("buildPayrollPeriodRead", () => {
	it("gives the Overview exactly the sum of each employee's day row", () => {
		const read = buildPayrollPeriodRead({
			organizationId: "organization-a",
			period: { start: "2026-11-01", end: "2026-11-30", label: "November 2026" },
			generatedAt: DateTime.fromISO("2026-11-30T12:00:00Z"),
			generatedBy: { id: "payroll-1", name: "Payroll User" },
			sources: {
				organizationName: "Acme GmbH",
				employees: [
					{
						id: "employee-1",
						name: "Anna Berg",
						employeeNumber: "E-1",
						teamName: "Ops",
						contractType: "fixed",
						timezone: "Europe/Berlin",
					},
				],
				work: [
					{
						recordId: "record-1",
						employeeId: "employee-1",
						startAt: Temporal.Instant.from("2026-11-09T21:00:00Z"),
						endExclusive: Temporal.Instant.from("2026-11-10T05:00:00Z"),
						minutes: 480,
					},
					{
						recordId: "record-2",
						employeeId: "employee-1",
						startAt: Temporal.Instant.from("2026-11-11T07:00:00Z"),
						endExclusive: Temporal.Instant.from("2026-11-11T07:20:00Z"),
						minutes: 20,
					},
				],
				absences: [
					{
						id: "absence-1",
						employeeId: "employee-1",
						categoryId: "vacation",
						categoryName: "Vacation",
						categoryType: "vacation",
						categoryColor: null,
						startDate: "2026-11-12",
						endDate: "2026-11-12",
						startPeriod: "full_day",
						endPeriod: "full_day",
						approvalState: "pending",
					},
				],
				blockers: [],
			},
		});

		const row = read.employees[0];
		const dayMinutes = row?.days.reduce((sum, day) => sum + day.creditedMinutes, 0);
		expect(dayMinutes).toBe(500);
		expect(read.summary.employees[0]?.workedHours).toBe(8.33);
		expect(read.summary.totals.totalWorkedHours).toBe(8.33);
		// A pending absence is shown on its day but not counted as paid absence.
		expect(read.summary.employees[0]?.absenceDaysByCategory).toEqual([]);
		expect(row?.days.find((day) => day.date === "2026-11-12")?.absences).toHaveLength(1);
	});
});

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

	describe("employees who left", () => {
		const anna = {
			id: "employee-1",
			name: "Anna Berg",
			employeeNumber: "E-1",
			teamName: "Ops",
			contractType: "fixed",
			timezone: "Europe/Berlin",
		};
		const ben = { ...anna, id: "employee-2", name: "Ben Cole", employeeNumber: "E-2" };
		const cleo = { ...anna, id: "employee-3", name: "Cleo Dorn", employeeNumber: "E-3" };
		const read = (sources: {
			employees: Parameters<typeof buildPayrollPeriodRead>[0]["sources"]["employees"];
			work?: Parameters<typeof buildPayrollPeriodRead>[0]["sources"]["work"];
			blockers?: Parameters<typeof buildPayrollPeriodRead>[0]["sources"]["blockers"];
		}) =>
			buildPayrollPeriodRead({
				organizationId: "organization-a",
				period: { start: "2026-11-01", end: "2026-11-30", label: "November 2026" },
				generatedAt: DateTime.fromISO("2026-11-30T12:00:00Z"),
				generatedBy: { id: "payroll-1", name: "Payroll User" },
				sources: {
					organizationName: "Acme GmbH",
					employees: sources.employees,
					work: sources.work ?? [],
					absences: [],
					blockers: sources.blockers ?? [],
				},
			});

		it("keeps an employee who left mid-period, with the last working day", () => {
			const result = read({
				employees: [{ ...anna, departure: { lastWorkingDay: "2026-11-13" } }],
				work: [
					{
						recordId: "record-1",
						employeeId: anna.id,
						startAt: Temporal.Instant.from("2026-11-13T08:00:00Z"),
						endExclusive: Temporal.Instant.from("2026-11-13T12:00:00Z"),
						minutes: 240,
					},
				],
			});

			expect(result.employees.map((row) => [row.id, row.departure])).toEqual([
				[anna.id, { lastWorkingDay: "2026-11-13" }],
			]);
			expect(result.employees[0]?.totals.creditedMinutes).toBe(240);
			expect(result.summary.employees.map((row) => [row.id, row.workedHours])).toEqual([
				[anna.id, 4],
			]);
		});

		it("leaves out an employee who left and has no hours, absences or blockers in the period", () => {
			const result = read({
				employees: [
					anna,
					{ ...ben, departure: { lastWorkingDay: "2026-11-05" } },
					{ ...cleo, departure: { lastWorkingDay: "2026-11-05" } },
				],
				blockers: [
					{
						id: "blocker-1",
						employeeId: cleo.id,
						type: "offboarding_clock_repair",
						label: "Offboarding clock-out needs repair",
						date: "2026-11-05",
						time: "18:00",
					},
				],
			});

			// Anna has not left; Cleo still has a blocker to resolve.
			expect(result.employees.map((row) => row.id)).toEqual([anna.id, cleo.id]);
			expect(result.summary.employees.map((row) => row.id)).toEqual([anna.id, cleo.id]);
			expect(result.summary.totals.employeeCount).toBe(2);
		});
	});
});

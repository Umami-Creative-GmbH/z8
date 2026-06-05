import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import {
	buildPayrollSummaryFromRows,
	calculatePayrollAbsenceDays,
	calculatePayrollWorkedMinutes,
	filterMissingClockOutBlockers,
	filterPendingTimeApprovalBlockers,
} from "./summary";

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

describe("calculatePayrollWorkedMinutes", () => {
	it("clips work records that start before or end after the payroll period", () => {
		const period = {
			start: DateTime.fromISO("2026-06-01T00:00:00Z"),
			end: DateTime.fromISO("2026-06-30T23:59:59Z"),
		};

		expect(
			calculatePayrollWorkedMinutes(
				[
					{
						employeeId: "employee-1",
						durationMinutes: 120,
						startAt: DateTime.fromISO("2026-05-31T23:00:00Z"),
						endAt: DateTime.fromISO("2026-06-01T01:00:00Z"),
					},
					{
						employeeId: "employee-1",
						durationMinutes: 120,
						startAt: DateTime.fromISO("2026-06-30T23:00:00Z"),
						endAt: DateTime.fromISO("2026-07-01T01:00:00Z"),
					},
				],
				period,
			).get("employee-1"),
		).toBe(120);
	});

	it("excludes open work records from payable worked totals", () => {
		const period = {
			start: DateTime.fromISO("2026-06-01T00:00:00Z"),
			end: DateTime.fromISO("2026-06-30T23:59:59Z"),
		};

		expect(
			calculatePayrollWorkedMinutes(
				[
					{
						employeeId: "employee-1",
						durationMinutes: null,
						startAt: DateTime.fromISO("2026-06-10T09:00:00Z"),
						endAt: null,
					},
				],
				period,
			).get("employee-1"),
		).toBeUndefined();
	});
});

describe("calculatePayrollAbsenceDays", () => {
	it("counts full-day same-day absences as one day", () => {
		expect(
			calculatePayrollAbsenceDays({
				startAt: DateTime.fromISO("2026-06-10T00:00:00Z"),
				endAt: DateTime.fromISO("2026-06-10T23:59:59Z"),
				startPeriod: "full_day",
				endPeriod: "full_day",
				period: {
					start: DateTime.fromISO("2026-06-01T00:00:00Z"),
					end: DateTime.fromISO("2026-06-30T23:59:59Z"),
				},
			}),
		).toBe(1);
	});

	it("counts same-day half-day absences as half a day", () => {
		expect(
			calculatePayrollAbsenceDays({
				startAt: DateTime.fromISO("2026-06-10T00:00:00Z"),
				endAt: DateTime.fromISO("2026-06-10T11:59:59Z"),
				startPeriod: "am",
				endPeriod: "am",
				period: {
					start: DateTime.fromISO("2026-06-01T00:00:00Z"),
					end: DateTime.fromISO("2026-06-30T23:59:59Z"),
				},
			}),
		).toBe(0.5);
	});

	it("clips multi-day absences to the selected payroll period", () => {
		expect(
			calculatePayrollAbsenceDays({
				startAt: DateTime.fromISO("2026-05-30T00:00:00Z"),
				endAt: DateTime.fromISO("2026-06-02T23:59:59Z"),
				startPeriod: "full_day",
				endPeriod: "full_day",
				period: {
					start: DateTime.fromISO("2026-06-01T00:00:00Z"),
					end: DateTime.fromISO("2026-06-30T23:59:59Z"),
				},
			}),
		).toBe(2);
	});
});

describe("filterPendingTimeApprovalBlockers", () => {
	it("keeps only pending time approvals linked to overlapping canonical time records", () => {
		const blockers = filterPendingTimeApprovalBlockers({
			organizationId: "org-1",
			allowedEmployeeIds: ["employee-1"],
			period: {
				start: DateTime.fromISO("2026-06-01T00:00:00Z"),
				end: DateTime.fromISO("2026-06-30T23:59:59Z"),
			},
			rows: [
				{
					id: "approval-1",
					organizationId: "org-1",
					requestedBy: "employee-1",
					status: "pending",
					entityType: "time_entry",
					canonicalRecordId: "record-1",
					recordId: "record-1",
					recordOrganizationId: "org-1",
					employeeId: "employee-1",
					startAt: DateTime.fromISO("2026-06-10T09:00:00Z"),
					endAt: DateTime.fromISO("2026-06-10T10:00:00Z"),
				},
				{
					id: "approval-2",
					organizationId: "org-1",
					requestedBy: "employee-1",
					status: "pending",
					entityType: "expense",
					canonicalRecordId: null,
					recordId: null,
					recordOrganizationId: null,
					employeeId: "employee-1",
					startAt: DateTime.fromISO("2026-06-10T09:00:00Z"),
					endAt: DateTime.fromISO("2026-06-10T10:00:00Z"),
				},
				{
					id: "approval-3",
					organizationId: "org-1",
					requestedBy: "employee-1",
					status: "pending",
					entityType: "time_entry",
					canonicalRecordId: "record-3",
					recordId: "record-3",
					recordOrganizationId: "org-1",
					employeeId: "employee-1",
					startAt: DateTime.fromISO("2026-07-10T09:00:00Z"),
					endAt: DateTime.fromISO("2026-07-10T10:00:00Z"),
				},
			],
		});

		expect(blockers).toEqual([
			{
				id: "approval-1",
				employeeId: "employee-1",
				type: "pending_time_correction",
				label: "Pending time correction",
			},
		]);
	});
});

describe("filterMissingClockOutBlockers", () => {
	it("includes open work records that started before the payroll period", () => {
		const blockers = filterMissingClockOutBlockers({
			period: {
				start: DateTime.fromISO("2026-06-01T00:00:00Z"),
				end: DateTime.fromISO("2026-06-30T23:59:59Z"),
			},
			rows: [
				{
					id: "record-1",
					employeeId: "employee-1",
					startAt: DateTime.fromISO("2026-05-31T23:00:00Z"),
				},
				{
					id: "record-2",
					employeeId: "employee-1",
					startAt: DateTime.fromISO("2026-07-01T00:00:00Z"),
				},
			],
		});

		expect(blockers).toEqual([
			{
				id: "record-1",
				employeeId: "employee-1",
				type: "missing_clock_out",
				label: "Missing clock-out",
			},
		]);
	});
});

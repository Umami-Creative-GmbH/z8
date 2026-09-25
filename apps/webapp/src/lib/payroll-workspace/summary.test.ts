import { DateTime } from "luxon";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { filterDismissedPayrollBlockers } from "./blocker-dismissals";
import {
	buildPayrollSummaryFromRows,
	buildOffboardingClockRepairBlockers,
	buildPendingAbsenceBlockers,
	calculatePayrollWorkedMinutes,
	filterMissingClockOutBlockers,
	filterPendingTimeApprovalBlockers,
	payrollBlockersFromCollection,
} from "./summary";
import { assessPayrollWorkCollection } from "@/lib/payroll-collection/payroll-work-collection";
import { workPeriodsFromCollectedInput } from "@/lib/payroll-export/collected-work";
import { isDismissiblePayrollBlockerType } from "./blocker-dismissals";
import type { PayrollSummaryWorkRow } from "./types";

function workRow(
	startAt: string,
	endAt: string,
	durationMinutes: number | null,
	overrides: Partial<PayrollSummaryWorkRow> = {},
): PayrollSummaryWorkRow {
	return {
		id: `record-${startAt}`,
		employeeId: "employee-1",
		timezone: "UTC",
		startAt: Temporal.Instant.from(startAt),
		endAt: Temporal.Instant.from(endAt),
		durationMinutes,
		...overrides,
	};
}

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
				workRow("2026-06-10T08:00:00Z", "2026-06-10T10:00:00Z", 120),
				workRow("2026-06-11T08:00:00Z", "2026-06-11T08:45:00Z", 45),
			],
			absenceRows: [],
			blockers: [],
		});

		expect(summary.totals.totalWorkedHours).toBe(2.75);
		expect(summary.employees[0]?.workedHours).toBe(2.75);
		expect(summary.generatedAt).toBe("2026-06-30T12:00:00.000Z");
		expect(summary.absenceDetails).toEqual([]);
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
				{
					employeeId: "employee-1",
					categoryId: "sick",
					categoryName: "Sick",
					startDate: "2026-06-12",
					endDate: "2026-06-12",
					startPeriod: "full_day",
					endPeriod: "full_day",
				},
				{
					employeeId: "employee-1",
					categoryId: "vacation",
					categoryName: "Vacation",
					startDate: "2026-06-10",
					endDate: "2026-06-11",
					startPeriod: "full_day",
					endPeriod: "full_day",
				},
			],
			blockers: [],
		});

		expect(summary.employees[0]?.absenceDaysByCategory).toEqual([
			{ categoryId: "sick", categoryName: "Sick", days: 1 },
			{ categoryId: "vacation", categoryName: "Vacation", days: 2 },
		]);
		expect(summary.absenceDetails).toEqual([
			{
				employeeId: "employee-1",
				categoryId: "vacation",
				categoryName: "Vacation",
				date: "2026-06-10",
				period: "full_day",
			},
			{
				employeeId: "employee-1",
				categoryId: "vacation",
				categoryName: "Vacation",
				date: "2026-06-11",
				period: "full_day",
			},
			{
				employeeId: "employee-1",
				categoryId: "sick",
				categoryName: "Sick",
				date: "2026-06-12",
				period: "full_day",
			},
		]);
	});

	it("includes a same-day half-day absence in details and category totals", () => {
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
				{
					employeeId: "employee-1",
					categoryId: "vacation",
					categoryName: "Vacation",
					startDate: "2026-06-10",
					endDate: "2026-06-10",
					startPeriod: "am",
					endPeriod: "am",
				},
			],
			blockers: [],
		});

		expect(summary.employees[0]?.absenceDaysByCategory).toEqual([
			{ categoryId: "vacation", categoryName: "Vacation", days: 0.5 },
		]);
		expect(summary.absenceDetails).toEqual([
			{
				employeeId: "employee-1",
				categoryId: "vacation",
				categoryName: "Vacation",
				date: "2026-06-10",
				period: "am",
			},
		]);
	});

	it("classifies timed partial absences and counts each as half a day", () => {
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
				{
					employeeId: "employee-1",
					categoryId: "afternoon",
					categoryName: "Afternoon",
					startDate: "2026-06-10",
					endDate: "2026-06-10",
					startPeriod: "am",
					endPeriod: "am",
					startTime: "14:00:00",
					endTime: "17:00:00",
				},
				{
					employeeId: "employee-1",
					categoryId: "morning",
					categoryName: "Morning",
					startDate: "2026-06-11",
					endDate: "2026-06-11",
					startPeriod: "am",
					endPeriod: "am",
					startTime: "09:00:00",
					endTime: "11:00:00",
				},
				{
					employeeId: "employee-1",
					categoryId: "cross-noon",
					categoryName: "Cross noon",
					startDate: "2026-06-12",
					endDate: "2026-06-12",
					startPeriod: "am",
					endPeriod: "am",
					startTime: "10:00:00",
					endTime: "14:00:00",
				},
				{
					employeeId: "employee-1",
					categoryId: "overnight",
					categoryName: "Overnight",
					startDate: "2026-06-13",
					endDate: "2026-06-14",
					startPeriod: "am",
					endPeriod: "am",
					startTime: "22:00:00",
					endTime: "02:00:00",
				},
			],
			blockers: [],
		});

		expect(summary.employees[0]?.absenceDaysByCategory).toEqual([
			{ categoryId: "afternoon", categoryName: "Afternoon", days: 0.5 },
			{ categoryId: "cross-noon", categoryName: "Cross noon", days: 0.5 },
			{ categoryId: "morning", categoryName: "Morning", days: 0.5 },
			{ categoryId: "overnight", categoryName: "Overnight", days: 0.5 },
		]);
		expect(
			summary.absenceDetails.map(({ date, period }) => ({ date, period })),
		).toEqual([
			{ date: "2026-06-10", period: "pm" },
			{ date: "2026-06-11", period: "am" },
			{ date: "2026-06-12", period: "partial_day" },
			{ date: "2026-06-13", period: "partial_day" },
		]);
	});

	it("sorts employees with identical names by id", () => {
		const summary = buildPayrollSummaryFromRows({
			organizationName: "Acme GmbH",
			period: { start: "2026-06-01", end: "2026-06-30", label: "June 2026" },
			generatedAt: DateTime.fromISO("2026-06-30T12:00:00Z"),
			generatedBy: { id: "payroll-1", name: "Payroll User" },
			employees: [
				{
					id: "employee-2",
					name: "Alex Smith",
					employeeNumber: null,
					teamName: null,
					contractType: "fixed",
				},
				{
					id: "employee-1",
					name: "Alex Smith",
					employeeNumber: null,
					teamName: null,
					contractType: "fixed",
				},
			],
			workRows: [],
			absenceRows: [],
			blockers: [],
		});

		expect(summary.employees.map((employee) => employee.id)).toEqual([
			"employee-1",
			"employee-2",
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
					date: "2026-06-10",
					time: "09:00",
				},
			],
		});

		expect(summary.totals.blockerCount).toBe(1);
		expect(summary.employees[0]?.hasBlockers).toBe(true);
		expect(summary.absenceDetails).toEqual([]);
	});

	it("derives list, count, and employee status only from blockers remaining after dismissal", () => {
		const remainingBlockers = filterDismissedPayrollBlockers(
			[
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
			],
			[{ blockerType: "missing_clock_out", sourceId: "source-1" }],
		);
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
				{
					id: "employee-2",
					name: "Grace Hopper",
					employeeNumber: "E-2",
					teamName: "Ops",
					contractType: "hourly",
				},
			],
			workRows: [workRow("2026-06-10T08:00:00Z", "2026-06-10T10:00:00Z", 120)],
			absenceRows: [],
			blockers: remainingBlockers,
		});

		expect(summary.blockers).toEqual([
			expect.objectContaining({ id: "source-2", type: "pending_absence" }),
		]);
		expect(summary.totals).toMatchObject({
			blockerCount: 1,
			totalWorkedHours: 2,
		});
		expect(summary.employees).toEqual([
			expect.objectContaining({
				id: "employee-1",
				hasBlockers: false,
				workedHours: 2,
			}),
			expect.objectContaining({ id: "employee-2", hasBlockers: true }),
		]);
	});
});

describe("calculatePayrollWorkedMinutes", () => {
	const june = { start: "2026-06-01", end: "2026-06-30" };

	it("allocates stored minutes of work records crossing the payroll period", () => {
		const { workedMinutesByEmployee, blockers } = calculatePayrollWorkedMinutes(
			[
				workRow("2026-05-31T23:00:00Z", "2026-06-01T01:00:00Z", 120),
				workRow("2026-06-30T23:00:00Z", "2026-07-01T01:00:00Z", 120),
			],
			june,
		);

		expect(workedMinutesByEmployee.get("employee-1")).toBe(120);
		expect(blockers).toEqual([]);
	});

	it("credits protected stored minutes instead of re-rounded endpoint time", () => {
		const { workedMinutesByEmployee } = calculatePayrollWorkedMinutes(
			[workRow("2026-06-10T08:00:00Z", "2026-06-10T09:00:40Z", 60)],
			june,
		);

		expect(workedMinutesByEmployee.get("employee-1")).toBe(60);
	});

	it("includes work on the last local day of the period", () => {
		const { workedMinutesByEmployee } = calculatePayrollWorkedMinutes(
			[workRow("2026-06-30T20:00:00Z", "2026-06-30T22:00:00Z", 120)],
			june,
		);

		expect(workedMinutesByEmployee.get("employee-1")).toBe(120);
	});

	it("uses each employee's local payroll window", () => {
		const { workedMinutesByEmployee } = calculatePayrollWorkedMinutes(
			[
				// 2026-06-01T02:00Z is still May 31 in New York.
				workRow("2026-06-01T02:00:00Z", "2026-06-01T03:00:00Z", 60, {
					employeeId: "employee-ny",
					timezone: "America/New_York",
				}),
				// 2026-05-31T22:30Z is already June 1 in Berlin.
				workRow("2026-05-31T22:30:00Z", "2026-05-31T23:30:00Z", 60, {
					employeeId: "employee-berlin",
					timezone: "Europe/Berlin",
				}),
			],
			june,
		);

		expect(workedMinutesByEmployee.get("employee-ny")).toBeUndefined();
		expect(workedMinutesByEmployee.get("employee-berlin")).toBe(60);
	});

	it("conserves stored minutes across adjacent payroll periods", () => {
		const rows = [workRow("2026-06-30T21:07:13Z", "2026-07-01T02:52:51Z", 346)];
		const juneMinutes = calculatePayrollWorkedMinutes(rows, june).workedMinutesByEmployee;
		const julyMinutes = calculatePayrollWorkedMinutes(rows, {
			start: "2026-07-01",
			end: "2026-07-31",
		}).workedMinutesByEmployee;

		expect((juneMinutes.get("employee-1") ?? 0) + (julyMinutes.get("employee-1") ?? 0)).toBe(
			346,
		);
	});

	it("reports work with an unlocated break across the boundary as a blocker", () => {
		const { workedMinutesByEmployee, blockers } = calculatePayrollWorkedMinutes(
			[
				workRow("2026-06-30T20:00:00Z", "2026-07-01T04:00:00Z", 450, {
					id: "record-unlocated",
					timezone: "Europe/Berlin",
				}),
				workRow("2026-06-10T08:00:00Z", "2026-06-10T10:00:00Z", 120),
			],
			june,
		);

		expect(workedMinutesByEmployee.get("employee-1")).toBe(120);
		expect(blockers).toEqual([
			{
				id: "record-unlocated",
				employeeId: "employee-1",
				type: "unresolved_work_minutes",
				label: "Unresolved work minutes",
				date: "2026-06-30",
				time: "22:00",
			},
		]);
	});

	it("distinguishes zero-minute work from completed work missing stored minutes", () => {
		const { workedMinutesByEmployee, blockers } = calculatePayrollWorkedMinutes(
			[
				workRow("2026-06-10T08:00:00Z", "2026-06-10T08:00:20Z", 0),
				workRow("2026-06-11T08:00:00Z", "2026-06-11T09:00:00Z", null, {
					id: "record-missing",
				}),
			],
			june,
		);

		expect(workedMinutesByEmployee.get("employee-1")).toBe(0);
		expect(blockers).toEqual([
			expect.objectContaining({ id: "record-missing", type: "unresolved_work_minutes" }),
		]);
	});
});

describe("buildPayrollSummaryFromRows work allocation blockers", () => {
	it("marks the employee as blocked and counts the unresolved work", () => {
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
			workRows: [workRow("2026-06-30T20:00:00Z", "2026-07-01T04:00:00Z", 450)],
			absenceRows: [],
			blockers: [],
		});

		expect(summary.totals).toMatchObject({ blockerCount: 1, totalWorkedHours: 0 });
		expect(summary.employees[0]).toMatchObject({ hasBlockers: true, workedHours: 0 });
		expect(summary.blockers[0]).toMatchObject({ type: "unresolved_work_minutes" });
	});
});

describe("filterPendingTimeApprovalBlockers", () => {
	it("uses the employee timezone to localize the correction start", () => {
		const blockers = filterPendingTimeApprovalBlockers({
			organizationId: "org-1",
			allowedEmployeeIds: ["employee-1"],
			period: {
				start: DateTime.fromISO("2026-06-01T00:00:00Z"),
				end: DateTime.fromISO("2026-06-30T23:59:59Z"),
			},
			timezoneByEmployeeId: new Map([["employee-1", "America/New_York"]]),
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
					startAt: DateTime.fromISO("2026-06-01T01:30:00Z"),
					endAt: DateTime.fromISO("2026-06-01T02:30:00Z"),
				},
			],
		});

		expect(blockers[0]).toMatchObject({ date: "2026-05-31", time: "21:30" });
	});

	it("retains a correction with invalid instant metadata without local date/time", () => {
		const blockers = filterPendingTimeApprovalBlockers({
			organizationId: "org-1",
			allowedEmployeeIds: ["employee-1"],
			period: {
				start: DateTime.fromISO("2026-06-01T00:00:00Z"),
				end: DateTime.fromISO("2026-06-30T23:59:59Z"),
			},
			timezoneByEmployeeId: new Map([["employee-1", "America/New_York"]]),
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
					startAt: DateTime.invalid("invalid metadata"),
					endAt: DateTime.fromISO("2026-06-01T02:30:00Z"),
				},
			],
		});

		expect(blockers[0]).toMatchObject({ date: null, time: null });
	});

	it("keeps only pending time approvals linked to overlapping canonical time records", () => {
		const blockers = filterPendingTimeApprovalBlockers({
			organizationId: "org-1",
			allowedEmployeeIds: ["employee-1"],
			period: {
				start: DateTime.fromISO("2026-06-01T00:00:00Z"),
				end: DateTime.fromISO("2026-06-30T23:59:59Z"),
			},
			timezoneByEmployeeId: new Map(),
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
				date: null,
				time: null,
			},
		]);
	});
});

describe("filterMissingClockOutBlockers", () => {
	it("uses the employee timezone to localize the missing clock-out start", () => {
		const blockers = filterMissingClockOutBlockers({
			period: {
				start: DateTime.fromISO("2026-06-01T00:00:00Z"),
				end: DateTime.fromISO("2026-06-30T23:59:59Z"),
			},
			timezoneByEmployeeId: new Map([["employee-1", "America/New_York"]]),
			rows: [
				{
					id: "record-1",
					employeeId: "employee-1",
					startAt: DateTime.fromISO("2026-06-01T01:30:00Z"),
				},
			],
		});

		expect(blockers[0]).toMatchObject({ date: "2026-05-31", time: "21:30" });
	});

	it("retains a missing clock-out when the employee timezone is invalid", () => {
		const blockers = filterMissingClockOutBlockers({
			period: {
				start: DateTime.fromISO("2026-06-01T00:00:00Z"),
				end: DateTime.fromISO("2026-06-30T23:59:59Z"),
			},
			timezoneByEmployeeId: new Map([["employee-1", "Invalid/Timezone"]]),
			rows: [
				{
					id: "record-1",
					employeeId: "employee-1",
					startAt: DateTime.fromISO("2026-06-01T01:30:00Z"),
				},
			],
		});

		expect(blockers).toEqual([
			{
				id: "record-1",
				employeeId: "employee-1",
				type: "missing_clock_out",
				label: "Missing clock-out",
				date: null,
				time: null,
			},
		]);
	});

	it("retains a missing clock-out with invalid instant metadata", () => {
		const blockers = filterMissingClockOutBlockers({
			period: {
				start: DateTime.fromISO("2026-06-01T00:00:00Z"),
				end: DateTime.fromISO("2026-06-30T23:59:59Z"),
			},
			timezoneByEmployeeId: new Map([["employee-1", "America/New_York"]]),
			rows: [
				{
					id: "record-1",
					employeeId: "employee-1",
					startAt: DateTime.invalid("invalid metadata"),
				},
			],
		});

		expect(blockers[0]).toMatchObject({ date: null, time: null });
	});

	it("includes open work records that started before the payroll period", () => {
		const blockers = filterMissingClockOutBlockers({
			period: {
				start: DateTime.fromISO("2026-06-01T00:00:00Z"),
				end: DateTime.fromISO("2026-06-30T23:59:59Z"),
			},
			timezoneByEmployeeId: new Map(),
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
				date: null,
				time: null,
			},
		]);
	});
});

describe("buildPendingAbsenceBlockers", () => {
	it("uses the logical absence start date without an event time", () => {
		expect(
			buildPendingAbsenceBlockers([
				{ id: "absence-1", employeeId: "employee-1", startDate: "2026-06-12" },
			]),
		).toEqual([
			{
				id: "absence-1",
				employeeId: "employee-1",
				type: "pending_absence",
				label: "Pending absence",
				date: "2026-06-12",
				time: null,
			},
		]);
	});
});

describe("buildOffboardingClockRepairBlockers", () => {
	it("blocks the employee at the departure cutoff in their timezone and cannot be dismissed", () => {
		const blockers = buildOffboardingClockRepairBlockers({
			timezoneByEmployeeId: new Map([["employee-1", "Europe/Berlin"]]),
			repairs: [
				{
					reviewId: "review-1",
					employeeId: "employee-1",
					affectedEndAt: new Date("2026-09-14T22:00:00Z"),
				},
			],
		});

		expect(blockers).toEqual([
			{
				id: "review-1",
				employeeId: "employee-1",
				type: "offboarding_clock_repair",
				label: "Offboarding clock-out needs repair",
				date: "2026-09-15",
				time: "00:00",
			},
		]);
		expect(isDismissiblePayrollBlockerType("offboarding_clock_repair")).toBe(false);
	});
});

describe("workspace under scoped collection (#322)", () => {
	const instant = (value: string) => Temporal.Instant.from(value);
	const employee = (id: string, timezone: string) => ({
		id,
		employeeNumber: null,
		firstName: null,
		lastName: null,
		email: null,
		timezone,
	});
	const record = (id: string, employeeId: string, overrides: object = {}) => ({
		id,
		employeeId,
		startAt: instant("2026-06-30T21:30:00Z"),
		endAt: instant("2026-06-30T22:30:00Z"),
		durationMinutes: 61,
		approvalState: "approved" as const,
		updatedAt: instant("2026-06-30T22:30:00Z"),
		workPeriod: null,
		workCategory: null,
		projects: [],
		...overrides,
	});
	const collection = assessPayrollWorkCollection(
		{
			employees: [employee("employee-1", "Europe/Berlin"), employee("employee-2", "UTC")],
			records: [
				record("boundary", "employee-1"),
				record("pending", "employee-2", { approvalState: "pending" }),
			],
			diagnostics: {
				completeness: { status: "incomplete", widenedTo: "organization" },
				findings: [
					{
						id: "finding-1",
						kind: "work_outside_organization_employees",
						shape: "conflicting",
						treatment: "investigation_required",
						blocking: true,
						employeeIds: [],
						workPeriodIds: [],
						timeRecordIds: [],
						entryIds: [],
						provenance: { state: "ambiguous", reason: "ownership_unestablished" },
						relevance: { level: "organization" },
						relevant: true,
						details: {},
					},
				],
			},
			departureRepairs: [],
		},
		{
			organizationId: "org-1",
			startDate: "2026-06-01",
			endDate: "2026-06-30",
			employeeIds: ["employee-1", "employee-2"],
			teamIds: null,
			projectIds: null,
		},
	);

	it("credits exactly the minutes the export formats", () => {
		const summary = buildPayrollSummaryFromRows({
			organizationName: "Acme GmbH",
			period: { start: "2026-06-01", end: "2026-06-30", label: "June 2026" },
			generatedAt: DateTime.fromISO("2026-06-30T12:00:00Z"),
			generatedBy: { id: "payroll-1", name: "Payroll User" },
			employees: [
				{ id: "employee-1", name: "Ada", employeeNumber: null, teamName: null, contractType: "hourly" },
			],
			workRows: [],
			collectedWork: collection.input.work,
			absenceRows: [],
			blockers: payrollBlockersFromCollection(collection),
		});
		const exportMinutes = workPeriodsFromCollectedInput(collection.input).reduce(
			(total, line) => total + (line.durationMinutes ?? 0),
			0,
		);

		// 23:30-00:30 Berlin with 61 stored minutes: 31 belong to June.
		expect(exportMinutes).toBe(31);
		expect(summary.employees[0]?.workedHours).toBe(Math.round((31 / 60) * 100) / 100);
		expect(summary.employees[0]?.hasBlockers).toBe(true);
	});

	it("lists every export blocker as a non-dismissible workspace blocker", () => {
		const blockers = payrollBlockersFromCollection(collection);

		expect(blockers.map((blocker) => [blocker.type, blocker.employeeId])).toEqual([
			["uncertain_historical_work", "employee-1"],
			["pending_work_approval", "employee-2"],
			["uncertain_historical_work", "employee-2"],
		]);
		// Finding IDs can name others' work: workspace IDs are opaque, distinct and stable.
		expect(JSON.stringify(blockers)).not.toContain("finding-1");
		expect(new Set(blockers.map((blocker) => blocker.id)).size).toBe(3);
		expect(payrollBlockersFromCollection(collection)).toEqual(blockers);
		expect(blockers.find((blocker) => blocker.id === "pending")).toMatchObject({
			date: "2026-06-30",
			time: "21:30",
		});
		expect(blockers.some((blocker) => isDismissiblePayrollBlockerType(blocker.type))).toBe(false);
	});
});

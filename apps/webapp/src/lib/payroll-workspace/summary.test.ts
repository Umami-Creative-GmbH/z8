import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { filterDismissedPayrollBlockers } from "./blocker-dismissals";
import {
	buildPayrollSummaryFromRows,
	buildPendingAbsenceBlockers,
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
			workRows: [{ employeeId: "employee-1", durationMinutes: 120 }],
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

import { describe, expect, it } from "vitest";
import {
	canActorManageTarget,
	canUseManagerAbsencePage,
} from "./manager-absence-permissions";
import { calculateManagerAbsenceMetrics } from "./manager-absence-metrics";
import {
	buildCanonicalAbsenceRecordValues,
	getAbsenceOverlapConflictMessage,
	getManagerAbsenceEmployees,
	managerAbsenceAdvisoryLockKey,
	normalizeManagerAbsenceListParams,
	recordAbsenceForEmployee,
	validateRecordAbsenceDateRange,
} from "./actions";

describe("manager absence server action contracts", () => {
	it("exports the list and record actions", () => {
		expect(typeof getManagerAbsenceEmployees).toBe("function");
		expect(typeof recordAbsenceForEmployee).toBe("function");
	});
});

describe("manager absence server action helpers", () => {
	it("normalizes list params to safe server-backed pagination defaults", () => {
		expect(
			normalizeManagerAbsenceListParams({
				search: "  E-123  ",
				page: -2,
				pageSize: 999,
				year: 1999,
			}),
		).toEqual({
			search: "E-123",
			page: 1,
			pageSize: 25,
			year: 1999,
		});

		expect(normalizeManagerAbsenceListParams({ page: 2, pageSize: 50 })).toMatchObject({
			page: 2,
			pageSize: 50,
		});
	});

	it("validates record absence date ranges", () => {
		expect(
			validateRecordAbsenceDateRange({
				startDate: "2026-04-10",
				startPeriod: "full_day",
				endDate: "2026-04-09",
				endPeriod: "full_day",
			}),
		).toBe("Start date must be before end date");

		expect(
			validateRecordAbsenceDateRange({
				startDate: "2026-04-10",
				startPeriod: "pm",
				endDate: "2026-04-10",
				endPeriod: "am",
			}),
		).toBe("Cannot end in the morning if starting in the afternoon on the same day");

		expect(
			validateRecordAbsenceDateRange({
				startDate: "2026-04-10",
				startPeriod: "am",
				endDate: "2026-04-10",
				endPeriod: "pm",
			}),
		).toBeNull();
	});

	it("builds approved canonical absence record values", () => {
		const values = buildCanonicalAbsenceRecordValues({
			organizationId: "org-1",
			employeeId: "employee-1",
			categoryId: "category-1",
			startDate: "2026-04-10",
			startPeriod: "pm",
			endDate: "2026-04-10",
			endPeriod: "pm",
			countsAgainstVacation: true,
			createdBy: "user-1",
		});

		expect(values.timeRecord).toMatchObject({
			organizationId: "org-1",
			employeeId: "employee-1",
			recordKind: "absence",
			approvalState: "approved",
			origin: "manual",
			createdBy: "user-1",
			updatedBy: "user-1",
		});
		expect(values.timeRecord.durationMinutes).toBe(719);
		expect(values.timeRecordAbsence).toEqual({
			organizationId: "org-1",
			recordKind: "absence",
			absenceCategoryId: "category-1",
			startPeriod: "pm",
			endPeriod: "pm",
			countsAgainstVacation: true,
		});
	});

	it("uses deterministic employee advisory lock keys and conflict messages", () => {
		expect(managerAbsenceAdvisoryLockKey("employee-1")).toBe("manager_absence:employee-1");
		expect(getAbsenceOverlapConflictMessage("pending")).toBe(
			"Absence request overlaps with an existing pending request",
		);
		expect(getAbsenceOverlapConflictMessage("approved")).toBe(
			"Absence request overlaps with an existing approved absence",
		);
	});
});

describe("manager absence permissions", () => {
	it("allows managers to manage assigned employees", () => {
		expect(
			canActorManageTarget({
				actor: { id: "manager-1", role: "manager", organizationId: "org-1" },
				target: { id: "employee-1", organizationId: "org-1", isActive: true },
				managerIdsForTarget: ["manager-1"],
			}),
		).toBe(true);
	});

	it("blocks managers from unmanaged employees", () => {
		expect(
			canActorManageTarget({
				actor: { id: "manager-1", role: "manager", organizationId: "org-1" },
				target: { id: "employee-1", organizationId: "org-1", isActive: true },
				managerIdsForTarget: ["manager-2"],
			}),
		).toBe(false);
	});

	it("allows admins to manage active employees in the same organization", () => {
		expect(
			canActorManageTarget({
				actor: { id: "admin-1", role: "admin", organizationId: "org-1" },
				target: { id: "employee-1", organizationId: "org-1", isActive: true },
				managerIdsForTarget: [],
			}),
		).toBe(true);
	});

	it("blocks employees from managing active same-organization targets", () => {
		expect(
			canActorManageTarget({
				actor: { id: "employee-1", role: "employee", organizationId: "org-1" },
				target: { id: "employee-2", organizationId: "org-1", isActive: true },
				managerIdsForTarget: [],
			}),
		).toBe(false);
	});

	it("blocks cross-organization and inactive targets", () => {
		expect(
			canActorManageTarget({
				actor: { id: "admin-1", role: "admin", organizationId: "org-1" },
				target: { id: "employee-1", organizationId: "org-2", isActive: true },
				managerIdsForTarget: [],
			}),
		).toBe(false);

		expect(
			canActorManageTarget({
				actor: { id: "admin-1", role: "admin", organizationId: "org-1" },
				target: { id: "employee-1", organizationId: "org-1", isActive: false },
				managerIdsForTarget: [],
			}),
		).toBe(false);
	});

	it("allows only managers and admins to open the page", () => {
		expect(canUseManagerAbsencePage("admin")).toBe(true);
		expect(canUseManagerAbsencePage("manager")).toBe(true);
		expect(canUseManagerAbsencePage("employee")).toBe(false);
	});
});

describe("manager absence metrics", () => {
	it("calculates vacation and sick metrics for the selected year", () => {
		const metrics = calculateManagerAbsenceMetrics({
			year: 2026,
			allowance: {
				defaultAnnualDays: "30",
				allowCarryover: false,
				maxCarryoverDays: null,
				carryoverExpiryMonths: null,
			},
			employeeAllowance: null,
			absences: [
				{
					id: "vacation-approved",
					employeeId: "employee-1",
					startDate: "2026-02-02",
					startPeriod: "full_day",
					endDate: "2026-02-03",
					endPeriod: "full_day",
					status: "approved",
					notes: null,
					approvedBy: "manager-1",
					approvedAt: new Date("2026-01-01T00:00:00.000Z"),
					rejectionReason: null,
					createdAt: new Date("2026-01-01T00:00:00.000Z"),
					category: {
						id: "category-vacation",
						name: "Vacation",
						type: "vacation",
						color: null,
						countsAgainstVacation: true,
					},
				},
				{
					id: "vacation-pending",
					employeeId: "employee-1",
					startDate: "2026-03-02",
					startPeriod: "full_day",
					endDate: "2026-03-02",
					endPeriod: "full_day",
					status: "pending",
					notes: null,
					approvedBy: null,
					approvedAt: null,
					rejectionReason: null,
					createdAt: new Date("2026-01-01T00:00:00.000Z"),
					category: {
						id: "category-vacation",
						name: "Vacation",
						type: "vacation",
						color: null,
						countsAgainstVacation: true,
					},
				},
				{
					id: "sick-approved",
					employeeId: "employee-1",
					startDate: "2026-04-06",
					startPeriod: "full_day",
					endDate: "2026-04-06",
					endPeriod: "full_day",
					status: "approved",
					notes: null,
					approvedBy: "manager-1",
					approvedAt: new Date("2026-01-01T00:00:00.000Z"),
					rejectionReason: null,
					createdAt: new Date("2026-01-01T00:00:00.000Z"),
					category: {
						id: "category-sick",
						name: "Sick Leave",
						type: "sick",
						color: null,
						countsAgainstVacation: false,
					},
				},
				{
					id: "sick-approved-previous-year",
					employeeId: "employee-1",
					startDate: "2025-04-07",
					startPeriod: "full_day",
					endDate: "2025-04-07",
					endPeriod: "full_day",
					status: "approved",
					notes: null,
					approvedBy: "manager-1",
					approvedAt: new Date("2025-01-01T00:00:00.000Z"),
					rejectionReason: null,
					createdAt: new Date("2025-01-01T00:00:00.000Z"),
					category: {
						id: "category-sick",
						name: "Sick Leave",
						type: "sick",
						color: null,
						countsAgainstVacation: false,
					},
				},
			],
		});

		expect(metrics).toEqual({
			vacationAllowance: 30,
			usedVacationDays: 2,
			pendingVacationDays: 1,
			remainingVacationDays: 27,
			sickDays: 1,
		});
	});

	it("calculates half-day sick metrics", () => {
		const metrics = calculateManagerAbsenceMetrics({
			year: 2026,
			allowance: {
				defaultAnnualDays: "30",
				allowCarryover: false,
				maxCarryoverDays: null,
				carryoverExpiryMonths: null,
			},
			employeeAllowance: null,
			absences: [
				{
					id: "sick-half-day",
					employeeId: "employee-1",
					startDate: "2026-05-04",
					startPeriod: "am",
					endDate: "2026-05-04",
					endPeriod: "am",
					status: "approved",
					notes: null,
					approvedBy: "manager-1",
					approvedAt: new Date("2026-01-01T00:00:00.000Z"),
					rejectionReason: null,
					createdAt: new Date("2026-01-01T00:00:00.000Z"),
					category: {
						id: "category-sick",
						name: "Sick Leave",
						type: "sick",
						color: null,
						countsAgainstVacation: false,
					},
				},
			],
		});

		expect(metrics).toEqual({
			vacationAllowance: 30,
			usedVacationDays: 0,
			pendingVacationDays: 0,
			remainingVacationDays: 30,
			sickDays: 0.5,
		});
	});

	it("returns zero vacation metrics without an allowance while retaining sick metrics", () => {
		const metrics = calculateManagerAbsenceMetrics({
			year: 2026,
			allowance: null,
			employeeAllowance: null,
			absences: [
				{
					id: "sick-without-allowance",
					employeeId: "employee-1",
					startDate: "2026-06-01",
					startPeriod: "full_day",
					endDate: "2026-06-01",
					endPeriod: "full_day",
					status: "approved",
					notes: null,
					approvedBy: "manager-1",
					approvedAt: new Date("2026-01-01T00:00:00.000Z"),
					rejectionReason: null,
					createdAt: new Date("2026-01-01T00:00:00.000Z"),
					category: {
						id: "category-sick",
						name: "Sick Leave",
						type: "sick",
						color: null,
						countsAgainstVacation: false,
					},
				},
			],
		});

		expect(metrics).toEqual({
			vacationAllowance: 0,
			usedVacationDays: 0,
			pendingVacationDays: 0,
			remainingVacationDays: 0,
			sickDays: 1,
		});
	});
});

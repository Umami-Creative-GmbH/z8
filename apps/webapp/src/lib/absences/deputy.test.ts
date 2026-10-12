import { describe, expect, it } from "vitest";
import type { PrincipalContext } from "@/lib/authorization";
import {
	canDeputyDecideApprovals,
	checkDeputyChangeAccess,
	checkDeputyForAbsence,
	deputyAwayPeriods,
} from "./deputy";

const ORG = "org-1";
const anna = "anna";
const ben = { id: "ben", organizationId: ORG, isActive: true };

describe("checkDeputyForAbsence", () => {
	it("accepts an absence without a deputy when the category does not require one", () => {
		expect(
			checkDeputyForAbsence({
				organizationId: ORG,
				absentEmployeeId: anna,
				deputyEmployeeId: null,
				deputy: null,
				deputyRequired: false,
			}),
		).toBeNull();
	});

	it("refuses an absence without a deputy when the category requires one", () => {
		expect(
			checkDeputyForAbsence({
				organizationId: ORG,
				absentEmployeeId: anna,
				deputyEmployeeId: undefined,
				deputy: null,
				deputyRequired: true,
			}),
		).toBe("deputy_required");
	});

	it("accepts an active colleague of the same organization", () => {
		expect(
			checkDeputyForAbsence({
				organizationId: ORG,
				absentEmployeeId: anna,
				deputyEmployeeId: ben.id,
				deputy: ben,
				deputyRequired: true,
			}),
		).toBeNull();
	});

	it("refuses the absent employee as their own deputy", () => {
		expect(
			checkDeputyForAbsence({
				organizationId: ORG,
				absentEmployeeId: anna,
				deputyEmployeeId: anna,
				deputy: { id: anna, organizationId: ORG, isActive: true },
				deputyRequired: false,
			}),
		).toBe("deputy_is_absent_employee");
	});

	it("refuses an inactive employee, an unknown one and one of another organization", () => {
		for (const deputy of [{ ...ben, isActive: false }, null, { ...ben, organizationId: "org-2" }]) {
			expect(
				checkDeputyForAbsence({
					organizationId: ORG,
					absentEmployeeId: anna,
					deputyEmployeeId: ben.id,
					deputy,
					deputyRequired: false,
				}),
			).toBe("deputy_unavailable");
		}
	});
});

describe("checkDeputyChangeAccess", () => {
	const absence = { employeeId: anna, status: "approved" as const, endDate: "2026-06-05" };
	const today = "2026-06-03";

	it("lets the absent employee, an admin and one of their managers change the deputy", () => {
		for (const actor of [
			{ employeeId: anna, role: "employee" as const, managesAbsentEmployee: false },
			{ employeeId: "olga", role: "admin" as const, managesAbsentEmployee: false },
			{ employeeId: "mia", role: "manager" as const, managesAbsentEmployee: true },
		]) {
			expect(checkDeputyChangeAccess({ actor, absence, today })).toBe("allowed");
		}
	});

	it("refuses colleagues and managers of other employees", () => {
		for (const actor of [
			{ employeeId: "ben", role: "employee" as const, managesAbsentEmployee: false },
			{ employeeId: "max", role: "manager" as const, managesAbsentEmployee: false },
		]) {
			expect(checkDeputyChangeAccess({ actor, absence, today })).toBe("forbidden");
		}
	});

	it("allows pending absences and absences ending today, never ended or closed ones", () => {
		const actor = { employeeId: anna, role: "employee" as const, managesAbsentEmployee: false };
		expect(
			checkDeputyChangeAccess({ actor, absence: { ...absence, status: "pending" }, today }),
		).toBe("allowed");
		expect(checkDeputyChangeAccess({ actor, absence: { ...absence, endDate: today }, today })).toBe(
			"allowed",
		);
		expect(
			checkDeputyChangeAccess({ actor, absence: { ...absence, endDate: "2026-06-02" }, today }),
		).toBe("absence_closed");
		expect(
			checkDeputyChangeAccess({ actor, absence: { ...absence, status: "rejected" }, today }),
		).toBe("absence_closed");
	});
});

describe("deputyAwayPeriods", () => {
	it("lists the colleague's own absences that overlap the requested dates, in order", () => {
		expect(
			deputyAwayPeriods(
				[
					{ startDate: "2026-06-10", endDate: "2026-06-12" },
					{ startDate: "2026-05-28", endDate: "2026-06-01" },
					{ startDate: "2026-06-03", endDate: "2026-06-05" },
					{ startDate: "2026-06-20", endDate: "2026-06-21" },
				],
				{ startDate: "2026-06-01", endDate: "2026-06-10" },
			),
		).toEqual([
			{ startDate: "2026-05-28", endDate: "2026-06-01" },
			{ startDate: "2026-06-03", endDate: "2026-06-05" },
			{ startDate: "2026-06-10", endDate: "2026-06-12" },
		]);
	});

	it("joins overlapping and back-to-back absences into one period", () => {
		expect(
			deputyAwayPeriods(
				[
					{ startDate: "2026-06-03", endDate: "2026-06-04" },
					{ startDate: "2026-06-05", endDate: "2026-06-05" },
					{ startDate: "2026-06-04", endDate: "2026-06-08" },
				],
				{ startDate: "2026-06-01", endDate: "2026-06-30" },
			),
		).toEqual([{ startDate: "2026-06-03", endDate: "2026-06-08" }]);
	});

	it("is empty when nothing overlaps", () => {
		expect(
			deputyAwayPeriods([{ startDate: "2026-07-01", endDate: "2026-07-02" }], {
				startDate: "2026-06-01",
				endDate: "2026-06-30",
			}),
		).toEqual([]);
	});
});

describe("canDeputyDecideApprovals", () => {
	function principal(
		role: "admin" | "manager" | "employee",
		overrides: Partial<PrincipalContext> = {},
	): PrincipalContext {
		return {
			userId: "user-ben",
			isPlatformAdmin: false,
			activeOrganizationId: ORG,
			orgMembership: { organizationId: ORG, role: "member", status: "active" },
			employee: { id: ben.id, organizationId: ORG, role, teamId: null },
			permissions: { orgWide: null, byTeamId: new Map() },
			managedEmployeeIds: [],
			customRoles: [],
			...overrides,
		};
	}

	it("lets managers and admins decide approvals", () => {
		expect(canDeputyDecideApprovals(principal("manager"))).toBe(true);
		expect(canDeputyDecideApprovals(principal("admin"))).toBe(true);
	});

	it("lets an employee with the approve permission decide approvals", () => {
		expect(
			canDeputyDecideApprovals(
				principal("employee", {
					permissions: {
						orgWide: {
							canCreateTeams: false,
							canManageTeamMembers: false,
							canManageTeamSettings: false,
							canApproveTeamRequests: true,
						},
						byTeamId: new Map(),
					},
				}),
			),
		).toBe(true);
	});

	it("makes any other employee a contact only", () => {
		expect(canDeputyDecideApprovals(principal("employee"))).toBe(false);
		expect(canDeputyDecideApprovals(principal("manager", { employee: null }))).toBe(false);
	});
});

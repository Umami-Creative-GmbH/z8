import { describe, expect, it } from "vitest";
import { resolveReportReviewer } from "../report-reviewer-routing";

const ORG = "org-1";

function employee(id: string, role: "admin" | "manager" | "employee" = "manager", isActive = true) {
	return { id, organizationId: ORG, isActive, role, teamId: null };
}

const base = {
	organizationId: ORG,
	requesterEmployeeId: "requester",
	employees: [employee("requester", "employee")],
	managerLinks: [] as { employeeId: string; managerId: string; isPrimary?: boolean }[],
	teamMemberships: [] as { employeeId: string; teamId: string }[],
	teams: [] as { id: string; organizationId: string; primaryManagerId: string | null }[],
	expenseApproverEmployeeId: null as string | null,
};

describe("resolveReportReviewer", () => {
	it("routes to the requester's direct manager first", () => {
		expect(
			resolveReportReviewer({
				...base,
				employees: [...base.employees, employee("manager"), employee("lead"), employee("finance")],
				managerLinks: [{ employeeId: "requester", managerId: "manager", isPrimary: true }],
				teamMemberships: [{ employeeId: "requester", teamId: "team" }],
				teams: [{ id: "team", organizationId: ORG, primaryManagerId: "lead" }],
				expenseApproverEmployeeId: "finance",
			}),
		).toEqual({ ok: true, reviewerId: "manager", source: "direct_manager" });
	});

	it("falls through to the team manager when the requester is their own direct manager", () => {
		expect(
			resolveReportReviewer({
				...base,
				employees: [employee("requester", "manager"), employee("lead")],
				managerLinks: [{ employeeId: "requester", managerId: "requester", isPrimary: true }],
				teamMemberships: [{ employeeId: "requester", teamId: "team" }],
				teams: [{ id: "team", organizationId: ORG, primaryManagerId: "lead" }],
			}),
		).toEqual({ ok: true, reviewerId: "lead", source: "team_manager" });
	});

	it("falls through to the organization expense approver when no manager is eligible", () => {
		expect(
			resolveReportReviewer({
				...base,
				employees: [employee("requester", "manager"), employee("finance", "admin")],
				teamMemberships: [{ employeeId: "requester", teamId: "team" }],
				teams: [{ id: "team", organizationId: ORG, primaryManagerId: "requester" }],
				expenseApproverEmployeeId: "finance",
			}),
		).toEqual({ ok: true, reviewerId: "finance", source: "expense_approver" });
	});

	it("never routes a report to its requester, even as the configured approver", () => {
		expect(
			resolveReportReviewer({
				...base,
				employees: [employee("requester", "admin")],
				managerLinks: [{ employeeId: "requester", managerId: "requester", isPrimary: true }],
				expenseApproverEmployeeId: "requester",
			}),
		).toEqual({ ok: false, reason: "no_eligible_reviewer" });
	});

	it("ignores an inactive, foreign-organization or non-reviewing expense approver", () => {
		const inactive = resolveReportReviewer({
			...base,
			employees: [...base.employees, employee("finance", "manager", false)],
			expenseApproverEmployeeId: "finance",
		});
		const foreign = resolveReportReviewer({
			...base,
			employees: [
				...base.employees,
				{ ...employee("finance", "manager"), organizationId: "other-org" },
			],
			expenseApproverEmployeeId: "finance",
		});
		// Only managers and admins can open the Approvals inbox to review it.
		const employeeRole = resolveReportReviewer({
			...base,
			employees: [...base.employees, employee("finance", "employee")],
			expenseApproverEmployeeId: "finance",
		});
		expect([inactive, foreign, employeeRole]).toEqual([
			{ ok: false, reason: "no_eligible_reviewer" },
			{ ok: false, reason: "no_eligible_reviewer" },
			{ ok: false, reason: "no_eligible_reviewer" },
		]);
	});

	it("does not route for an inactive requester", () => {
		expect(
			resolveReportReviewer({
				...base,
				employees: [employee("requester", "employee", false), employee("manager")],
				managerLinks: [{ employeeId: "requester", managerId: "manager", isPrimary: true }],
			}),
		).toEqual({ ok: false, reason: "requester_inactive" });
	});
});

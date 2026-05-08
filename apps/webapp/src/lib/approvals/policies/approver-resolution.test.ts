import { describe, expect, it } from "vitest";
import { resolveApproverFromDirectory } from "./approver-resolution";
import type { EligibleTeam, EligibleTeamMembership } from "./manager-eligibility";
import type { ApprovalPolicyStageDraft } from "./types";

const employees = [
	{ id: "emp_requester", organizationId: "org_1", isActive: true, role: "employee" as const },
	{ id: "emp_manager", organizationId: "org_1", isActive: true, role: "manager" as const },
	{ id: "emp_senior_manager", organizationId: "org_1", isActive: true, role: "manager" as const },
	{ id: "emp_admin", organizationId: "org_1", isActive: true, role: "admin" as const },
	{ id: "emp_other_org", organizationId: "org_2", isActive: true, role: "admin" as const },
];

const managerLinks = [
	{ employeeId: "emp_requester", managerId: "emp_manager" },
	{ employeeId: "emp_manager", managerId: "emp_senior_manager" },
];

const teamMemberships: EligibleTeamMembership[] = [];
const teams: EligibleTeam[] = [];

function stage(input: Partial<ApprovalPolicyStageDraft>): ApprovalPolicyStageDraft {
	return { id: "stage_1", stepOrder: 1, label: "Stage", approverType: "direct_manager", ...input };
}

describe("resolveApproverFromDirectory", () => {
	it("resolves direct manager inside the organization", () => {
		expect(
			resolveApproverFromDirectory({
				organizationId: "org_1",
				requesterEmployeeId: "emp_requester",
				stage: stage({ approverType: "direct_manager" }),
				employees,
				managerLinks,
				teamMemberships,
				teams,
			}),
		).toEqual({ ok: true, approverEmployeeId: "emp_manager" });
	});

	it("resolves direct manager through team fallback when no direct manager exists", () => {
		expect(
			resolveApproverFromDirectory({
				organizationId: "org_1",
				requesterEmployeeId: "emp_requester",
				stage: stage({ approverType: "direct_manager" }),
				employees: [
					...employees,
					{ id: "emp_team_manager", organizationId: "org_1", isActive: true, role: "manager" as const },
				],
				managerLinks: [],
				teamMemberships: [{ employeeId: "emp_requester", teamId: "team_1" }],
				teams: [{ id: "team_1", organizationId: "org_1", primaryManagerId: "emp_team_manager" }],
			}),
		).toEqual({ ok: true, approverEmployeeId: "emp_team_manager" });
	});

	it("prefers the primary direct manager link", () => {
		expect(
			resolveApproverFromDirectory({
				organizationId: "org_1",
				requesterEmployeeId: "emp_requester",
				stage: stage({ approverType: "direct_manager" }),
				employees: [
					...employees,
					{ id: "emp_backup_manager", organizationId: "org_1", isActive: true, role: "manager" as const },
				],
				managerLinks: [
					{ employeeId: "emp_requester", managerId: "emp_backup_manager" },
					{ employeeId: "emp_requester", managerId: "emp_manager", isPrimary: true },
				],
				teamMemberships,
				teams,
			}),
		).toEqual({ ok: true, approverEmployeeId: "emp_manager" });
	});

	it("selects the lowest manager id when no primary link exists", () => {
		expect(
			resolveApproverFromDirectory({
				organizationId: "org_1",
				requesterEmployeeId: "emp_requester",
				stage: stage({ approverType: "direct_manager" }),
				employees: [
					...employees,
					{ id: "emp_z_manager", organizationId: "org_1", isActive: true, role: "manager" as const },
					{ id: "emp_a_manager", organizationId: "org_1", isActive: true, role: "manager" as const },
				],
				managerLinks: [
					{ employeeId: "emp_requester", managerId: "emp_z_manager" },
					{ employeeId: "emp_requester", managerId: "emp_a_manager" },
				],
				teamMemberships,
				teams,
			}),
		).toEqual({ ok: true, approverEmployeeId: "emp_a_manager" });
	});

	it("does not depend on input order for duplicate manager links", () => {
		const employeesWithManagers = [
			...employees,
			{ id: "emp_z_manager", organizationId: "org_1", isActive: true, role: "manager" as const },
			{ id: "emp_a_manager", organizationId: "org_1", isActive: true, role: "manager" as const },
		];

		const input = {
			organizationId: "org_1",
			requesterEmployeeId: "emp_requester",
			stage: stage({ approverType: "direct_manager" }),
			employees: employeesWithManagers,
		};

		expect(
			resolveApproverFromDirectory({
				...input,
				managerLinks: [
					{ employeeId: "emp_requester", managerId: "emp_z_manager" },
					{ employeeId: "emp_requester", managerId: "emp_a_manager" },
				],
				teamMemberships,
				teams,
			}),
		).toEqual(
			resolveApproverFromDirectory({
				...input,
				managerLinks: [
					{ employeeId: "emp_requester", managerId: "emp_a_manager" },
					{ employeeId: "emp_requester", managerId: "emp_z_manager" },
				],
				teamMemberships,
				teams,
			}),
		);
	});

	it("rejects inactive requesters before resolving an organization admin", () => {
		expect(
			resolveApproverFromDirectory({
				organizationId: "org_1",
				requesterEmployeeId: "emp_requester",
				stage: stage({ approverType: "org_admin" }),
				employees: employees.map((employee) =>
					employee.id === "emp_requester" ? { ...employee, isActive: false } : employee,
				),
				managerLinks,
				teamMemberships,
				teams,
			}),
		).toEqual({ ok: false, reason: "Requester is not active in this organization." });
	});

	it("rejects cross-organization requesters before resolving a specific employee", () => {
		expect(
			resolveApproverFromDirectory({
				organizationId: "org_1",
				requesterEmployeeId: "emp_requester",
				stage: stage({ approverType: "specific_employee", approverEmployeeId: "emp_admin" }),
				employees: employees.map((employee) =>
					employee.id === "emp_requester" ? { ...employee, organizationId: "org_2" } : employee,
				),
				managerLinks,
				teamMemberships,
				teams,
			}),
		).toEqual({ ok: false, reason: "Requester is not active in this organization." });
	});

	it("resolves organization admin inside the organization", () => {
		expect(
			resolveApproverFromDirectory({
				organizationId: "org_1",
				requesterEmployeeId: "emp_requester",
				stage: stage({ approverType: "org_admin" }),
				employees,
				managerLinks,
				teamMemberships,
				teams,
			}),
		).toEqual({ ok: true, approverEmployeeId: "emp_admin" });
	});

	it("selects organization admin deterministically by employee id", () => {
		expect(
			resolveApproverFromDirectory({
				organizationId: "org_1",
				requesterEmployeeId: "emp_requester",
				stage: stage({ approverType: "org_admin" }),
				employees: [
					{ id: "emp_requester", organizationId: "org_1", isActive: true, role: "employee" as const },
					{ id: "emp_admin_z", organizationId: "org_1", isActive: true, role: "admin" as const },
					{ id: "emp_admin_a", organizationId: "org_1", isActive: true, role: "admin" as const },
				],
				managerLinks,
				teamMemberships,
				teams,
			}),
		).toEqual({ ok: true, approverEmployeeId: "emp_admin_a" });
	});

	it("resolves manager manager through active managers inside the organization", () => {
		expect(
			resolveApproverFromDirectory({
				organizationId: "org_1",
				requesterEmployeeId: "emp_requester",
				stage: stage({ approverType: "manager_manager" }),
				employees,
				managerLinks,
				teamMemberships,
				teams,
			}),
		).toEqual({ ok: true, approverEmployeeId: "emp_senior_manager" });
	});

	it("rejects manager manager when direct manager is inactive", () => {
		expect(
			resolveApproverFromDirectory({
				organizationId: "org_1",
				requesterEmployeeId: "emp_requester",
				stage: stage({ approverType: "manager_manager" }),
				employees: employees.map((employee) =>
					employee.id === "emp_manager" ? { ...employee, isActive: false } : employee,
				),
				managerLinks,
				teamMemberships,
				teams,
			}),
		).toEqual({ ok: false, reason: "Requester has no active direct manager in this organization." });
	});

	it("rejects manager manager when direct manager is outside the organization", () => {
		expect(
			resolveApproverFromDirectory({
				organizationId: "org_1",
				requesterEmployeeId: "emp_requester",
				stage: stage({ approverType: "manager_manager" }),
				employees: employees.map((employee) =>
					employee.id === "emp_manager" ? { ...employee, organizationId: "org_2" } : employee,
				),
				managerLinks,
				teamMemberships,
				teams,
			}),
		).toEqual({ ok: false, reason: "Requester has no active direct manager in this organization." });
	});

	it("rejects unsupported team lead stages", () => {
		expect(
			resolveApproverFromDirectory({
				organizationId: "org_1",
				requesterEmployeeId: "emp_requester",
				stage: stage({ approverType: "team_lead" }),
				employees,
				managerLinks,
				teamMemberships,
				teams,
			}),
		).toEqual({ ok: false, reason: "Team lead approver stages are not available." });
	});

	it("rejects missing specific approvers", () => {
		expect(
			resolveApproverFromDirectory({
				organizationId: "org_1",
				requesterEmployeeId: "emp_requester",
				stage: stage({ approverType: "specific_employee", approverEmployeeId: "emp_missing" }),
				employees,
				managerLinks,
				teamMemberships,
				teams,
			}),
		).toEqual({ ok: false, reason: "Specific approver is not active in this organization." });
	});

	it("rejects cross-organization specific approvers", () => {
		expect(
			resolveApproverFromDirectory({
				organizationId: "org_1",
				requesterEmployeeId: "emp_requester",
				stage: stage({ approverType: "specific_employee", approverEmployeeId: "emp_other_org" }),
				employees,
				managerLinks,
				teamMemberships,
				teams,
			}),
		).toEqual({ ok: false, reason: "Specific approver is not active in this organization." });
	});
});

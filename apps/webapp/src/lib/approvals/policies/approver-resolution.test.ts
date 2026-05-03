import { describe, expect, it } from "vitest";
import { resolveApproverFromDirectory } from "./approver-resolution";
import type { ApprovalPolicyStageDraft } from "./types";

const employees = [
	{ id: "emp_requester", organizationId: "org_1", isActive: true, role: "employee" as const },
	{ id: "emp_manager", organizationId: "org_1", isActive: true, role: "manager" as const },
	{ id: "emp_admin", organizationId: "org_1", isActive: true, role: "admin" as const },
	{ id: "emp_other_org", organizationId: "org_2", isActive: true, role: "admin" as const },
];

const managerLinks = [{ employeeId: "emp_requester", managerId: "emp_manager" }];

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
			}),
		).toEqual({ ok: true, approverEmployeeId: "emp_manager" });
	});

	it("resolves organization admin inside the organization", () => {
		expect(
			resolveApproverFromDirectory({
				organizationId: "org_1",
				requesterEmployeeId: "emp_requester",
				stage: stage({ approverType: "org_admin" }),
				employees,
				managerLinks,
			}),
		).toEqual({ ok: true, approverEmployeeId: "emp_admin" });
	});

	it("rejects cross-organization specific approvers", () => {
		expect(
			resolveApproverFromDirectory({
				organizationId: "org_1",
				requesterEmployeeId: "emp_requester",
				stage: stage({ approverType: "specific_employee", approverEmployeeId: "emp_other_org" }),
				employees,
				managerLinks,
			}),
		).toEqual({ ok: false, reason: "Specific approver is not active in this organization." });
	});
});

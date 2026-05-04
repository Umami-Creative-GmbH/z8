import { describe, expect, it } from "vitest";
import { normalizeApprovalPolicyInputForTest, previewApprovalPolicyForTest } from "./action-helpers";

describe("approval policy settings actions", () => {
	it("normalizes policy input and rejects active policies without stages", () => {
		const result = normalizeApprovalPolicyInputForTest({
			name: "Escalated absences",
			description: "",
			isActive: true,
			priority: 10,
			conditions: [{ conditionType: "approval_type", operator: "equals", value: "absence_entry" }],
			stages: [],
		});

		expect(result).toEqual({ success: false, error: "Active policies require at least one approval stage." });
	});

	it("normalizes valid policy input and trims text fields", () => {
		const result = normalizeApprovalPolicyInputForTest({
			name: "  Escalated absences  ",
			description: "  Requires manager review  ",
			isActive: true,
			priority: 10,
			conditions: [{ conditionType: "approval_type", operator: "equals", value: "absence_entry" }],
			stages: [{ id: "stage_1", stepOrder: 1, label: "  Manager  ", approverType: "direct_manager" }],
		});

		expect(result).toEqual({
			success: true,
			data: {
				name: "Escalated absences",
				description: "Requires manager review",
				isActive: true,
				priority: 10,
				conditions: [{ conditionType: "approval_type", operator: "equals", value: "absence_entry" }],
				stages: [{ id: "stage_1", stepOrder: 1, label: "Manager", approverType: "direct_manager" }],
			},
		});
	});

	it("previews the first matching policy and resolved approver labels", () => {
		const result = previewApprovalPolicyForTest({
			context: {
				organizationId: "org_1",
				approvalType: "absence_entry",
				requesterEmployeeId: "emp_requester",
				teamId: null,
				locationId: null,
				absenceCategoryId: null,
				travelExpenseAmount: null,
				overtimeRisk: null,
				employeeGroupIds: [],
				entityType: "absence_entry",
				entityId: "absence_1",
			},
			policies: [
				{
					id: "policy_2",
					organizationId: "org_1",
					name: "Fallback absence chain",
					isActive: true,
					priority: 20,
					conditions: [{ conditionType: "approval_type", operator: "equals", value: "absence_entry" }],
					stages: [{ id: "stage_2", stepOrder: 1, label: "Admin", approverType: "org_admin" }],
				},
				{
					id: "policy_1",
					organizationId: "org_1",
					name: "Absence chain",
					isActive: true,
					priority: 1,
					conditions: [{ conditionType: "approval_type", operator: "equals", value: "absence_entry" }],
					stages: [{ id: "stage_1", stepOrder: 1, label: "Manager", approverType: "specific_employee", approverEmployeeId: "emp_manager" }],
				},
			],
			employees: [
				{ id: "emp_requester", organizationId: "org_1", isActive: true, role: "employee" },
				{ id: "emp_manager", organizationId: "org_1", isActive: true, role: "manager" },
			],
			managerLinks: [],
		});

		expect(result).toEqual({
			matchedPolicyId: "policy_1",
			matchedPolicyName: "Absence chain",
			stages: [{ label: "Manager", approverEmployeeId: "emp_manager", status: "resolved" }],
		});
	});
});

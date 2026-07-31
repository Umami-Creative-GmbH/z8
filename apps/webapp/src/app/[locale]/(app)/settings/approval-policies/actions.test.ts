import { describe, expect, it } from "vitest";
import {
	normalizeApprovalPolicyInputForTest,
	previewApprovalPolicyForTest,
} from "./action-helpers";

describe("approval policy settings actions", () => {
	it("rejects active policies without stages", () => {
		const result = normalizeApprovalPolicyInputForTest({
			name: "Escalated absences",
			description: "",
			isActive: true,
			priority: 10,
			conditions: [
				{
					conditionType: "approval_type",
					operator: "equals",
					value: "absence_entry",
				},
			],
			stages: [],
		});

		expect(result).toEqual({
			success: false,
			error: "Active policies require at least one approval stage.",
		});
	});

	it("allows inactive policies without stages", () => {
		const result = normalizeApprovalPolicyInputForTest({
			name: "Draft absences",
			description: "",
			isActive: false,
			priority: 10,
			conditions: [
				{
					conditionType: "approval_type",
					operator: "equals",
					value: "absence_entry",
				},
			],
			stages: [],
		});

		expect(result).toEqual({
			success: true,
			data: {
				name: "Draft absences",
				description: "",
				isActive: false,
				priority: 10,
				conditions: [
					{
						conditionType: "approval_type",
						operator: "equals",
						value: "absence_entry",
					},
				],
				stages: [],
			},
		});
	});

	it("normalizes canonical approval types and defaults omitted stage fallback to fail", () => {
		const result = normalizeApprovalPolicyInputForTest({
			name: "  Canonical workflows  ",
			description: "  Requires manager review  ",
			isActive: true,
			priority: 10,
			conditions: [
				{
					conditionType: "approval_type",
					operator: "in",
					values: ["manual_time_submission", "compliance_exception"],
				},
			],
			stages: [
				{
					id: "stage_1",
					stepOrder: 1,
					label: "  Manager  ",
					approverType: "direct_manager",
				},
			],
		});

		expect(result).toEqual({
			success: true,
			data: {
				name: "Canonical workflows",
				description: "Requires manager review",
				isActive: true,
				priority: 10,
				conditions: [
					{
						conditionType: "approval_type",
						operator: "in",
						values: ["manual_time_submission", "compliance_exception"],
					},
				],
				stages: [
					{
						id: "stage_1",
						stepOrder: 1,
						label: "Manager",
						approverType: "direct_manager",
						fallbackBehavior: "fail",
					},
				],
			},
		});
	});

	it("accepts legacy persisted approval types", () => {
		const result = normalizeApprovalPolicyInputForTest({
			name: "Legacy workflows",
			description: "",
			isActive: true,
			priority: 10,
			conditions: [
				{
					conditionType: "approval_type",
					operator: "in",
					values: [
						"absence_entry",
						"time_entry",
						"shift_request",
						"travel_expense_claim",
					],
				},
			],
			stages: [
				{
					id: "stage_1",
					stepOrder: 1,
					label: "Manager",
					approverType: "direct_manager",
					fallbackBehavior: "default_manager",
				},
			],
		});

		expect(result).toMatchObject({
			success: true,
			data: {
				conditions: [
					{
						conditionType: "approval_type",
						operator: "in",
						values: [
							"absence_entry",
							"time_entry",
							"shift_request",
							"travel_expense_claim",
						],
					},
				],
				stages: [{ fallbackBehavior: "default_manager" }],
			},
		});
	});

	it("rejects unsupported stage fallbacks", () => {
		const result = normalizeApprovalPolicyInputForTest({
			name: "Unsupported fallback",
			description: "",
			isActive: true,
			priority: 10,
			conditions: [],
			stages: [
				{
					id: "stage_1",
					stepOrder: 1,
					label: "Manager",
					approverType: "direct_manager",
					fallbackBehavior: "manager",
				},
			],
		});

		expect(result.success).toBe(false);
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
					conditions: [
						{
							conditionType: "approval_type",
							operator: "equals",
							value: "absence_entry",
						},
					],
					stages: [
						{
							id: "stage_2",
							stepOrder: 1,
							label: "Admin",
							approverType: "org_admin",
							fallbackBehavior: "fail",
						},
					],
				},
				{
					id: "policy_1",
					organizationId: "org_1",
					name: "Absence chain",
					isActive: true,
					priority: 1,
					conditions: [
						{
							conditionType: "approval_type",
							operator: "equals",
							value: "absence_entry",
						},
					],
					stages: [
						{
							id: "stage_1",
							stepOrder: 1,
							label: "Manager",
							approverType: "specific_employee",
							approverEmployeeId: "emp_manager",
							fallbackBehavior: "fail",
						},
					],
				},
			],
			employees: [
				{
					id: "emp_requester",
					organizationId: "org_1",
					isActive: true,
					role: "employee",
				},
				{
					id: "emp_manager",
					organizationId: "org_1",
					isActive: true,
					role: "manager",
				},
			],
			managerLinks: [],
		});

		expect(result).toEqual({
			matchedPolicyId: "policy_1",
			matchedPolicyName: "Absence chain",
			stages: [
				{
					label: "Manager",
					approverEmployeeId: "emp_manager",
					status: "resolved",
				},
			],
		});
	});
});

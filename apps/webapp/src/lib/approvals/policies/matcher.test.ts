import { describe, expect, it } from "vitest";
import { findMatchingPolicy, validatePolicyDraft } from "./matcher";
import type { ApprovalPolicyDraft, ApprovalPolicyEvaluationContext } from "./types";

const context: ApprovalPolicyEvaluationContext = {
	organizationId: "org_1",
	approvalType: "absence_entry",
	requesterEmployeeId: "emp_1",
	teamId: "team_1",
	locationId: "loc_1",
	absenceCategoryId: "cat_1",
	travelExpenseAmount: 750,
	overtimeRisk: "warning",
	employeeGroupIds: ["group_1"],
	entityType: "absence_entry",
	entityId: "entity_1",
};

const matchingPolicy: ApprovalPolicyDraft = {
	id: "policy_1",
	organizationId: "org_1",
	name: "High control absences",
	isActive: true,
	priority: 10,
	conditions: [
		{ conditionType: "approval_type", operator: "in", values: ["absence_entry"] },
		{ conditionType: "team", operator: "equals", value: "team_1" },
		{ conditionType: "location", operator: "equals", value: "loc_1" },
		{ conditionType: "absence_category", operator: "equals", value: "cat_1" },
		{ conditionType: "employee_group", operator: "in", values: ["group_1", "group_2"] },
		{ conditionType: "overtime_risk", operator: "in", values: ["warning", "violation"] },
		{ conditionType: "travel_expense_amount", operator: "between", amountMin: 500, amountMax: 1000 },
	],
	stages: [{ id: "stage_1", stepOrder: 1, label: "Manager", approverType: "direct_manager" }],
};

describe("findMatchingPolicy", () => {
	it("selects the first active policy by ascending priority where every condition matches", () => {
		const result = findMatchingPolicy(context, [
			{ ...matchingPolicy, id: "later", priority: 20 },
			{ ...matchingPolicy, id: "first", priority: 5 },
		]);

		expect(result?.id).toBe("first");
	});

	it("returns null when no active policy matches", () => {
		const result = findMatchingPolicy(context, [
			{ ...matchingPolicy, isActive: false },
			{ ...matchingPolicy, conditions: [{ conditionType: "team", operator: "equals", value: "team_x" }] },
		]);

		expect(result).toBeNull();
	});
});

describe("validatePolicyDraft", () => {
	it("rejects active policies without stages", () => {
		expect(validatePolicyDraft({ ...matchingPolicy, stages: [] })).toEqual([
			"Active policies require at least one approval stage.",
		]);
	});

	it("rejects unsupported team lead stages", () => {
		expect(
			validatePolicyDraft({
				...matchingPolicy,
				stages: [{ id: "stage_1", stepOrder: 1, label: "Team Lead", approverType: "team_lead" }],
			}),
		).toContain("Team lead approver stages are not available until team lead relationships exist.");
	});
});

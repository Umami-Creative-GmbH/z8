import { describe, expect, it } from "vitest";
import type {
	ApprovalPolicyConditionDraft,
	ApprovalPolicyDraft,
	ApprovalPolicyStageDraft,
} from "../policies/types";
import {
	ApprovalRoutingPolicyValidationError,
	findMatchingRoutingPolicy,
	validateRoutingPolicy,
} from "./policy-matcher";
import type { ApprovalRoutingContext, RoutingStageFallback } from "./types";

const baseContext: ApprovalRoutingContext = {
	organizationId: "org_5a8c6a12-21c0-4f6f-9bd1-53de7c1e5fe1",
	workflowType: "manual_time_submission",
	source: {
		type: "time_entry",
		id: "entry_6ee2b191-f03d-40ce-9fda-baa66d4bf91a",
	},
	requesterEmployeeId: "employee_20d7a90f-9033-486f-981f-1fe532511aad",
	teamIds: [
		"team_2c1d5ef1-8508-4f91-a4de-c3215ef2bd3c",
		"team_7987de2d-01d4-4784-9955-188d023039d2",
	],
	locationId: "location_168b0acd-2c5a-47f4-bc2a-bda54a73f5af",
	absenceCategoryId: "absence_category_6d9d0fd1-e0d7-438d-a719-2794fc2f1044",
	travelExpenseAmount: 750,
	overtimeRisk: "warning",
	employeeGroupIds: ["employee_group_b8de866c-af3e-46e9-9628-4739fd5b3e38"],
};

function stage(
	fallbackBehavior: RoutingStageFallback = "fail",
): ApprovalPolicyStageDraft {
	return {
		id: "stage_0fa99cc5-555b-4e23-865d-32f72ba55d24",
		stepOrder: 1,
		label: "Manager",
		approverType: "direct_manager",
		fallbackBehavior,
	};
}

function policy({
	id = "policy_9308152b-648a-488c-a8b3-0ecf0d0507aa",
	organizationId = baseContext.organizationId,
	isActive = true,
	priority = 10,
	conditions = [],
	stages = [stage()],
}: Partial<ApprovalPolicyDraft> = {}): ApprovalPolicyDraft {
	return {
		id,
		organizationId,
		name: "Routing policy",
		isActive,
		priority,
		conditions,
		stages,
	};
}

function condition(
	input: ApprovalPolicyConditionDraft,
): ApprovalPolicyConditionDraft {
	return input;
}

describe("findMatchingRoutingPolicy", () => {
	it.each([
		["absence", "absence_entry"],
		["time_correction", "time_entry"],
		["manual_time_submission", "time_entry"],
		["policy_clock_out", "time_entry"],
		["travel_expense", "travel_expense_claim"],
	] as const)("matches %s against its legacy %s policy value", (workflowType, legacyValue) => {
		const aliasPolicy = policy({
			conditions: [
				condition({
					conditionType: "approval_type",
					operator: "equals",
					value: legacyValue,
				}),
			],
		});

		expect(
			findMatchingRoutingPolicy({ ...baseContext, workflowType }, [aliasPolicy])
				?.id,
		).toBe(aliasPolicy.id);
	});

	it.each([
		"shift_request",
		"compliance_exception",
	] as const)("matches %s only against its canonical policy value", (workflowType) => {
		const canonicalPolicy = policy({
			conditions: [
				condition({
					conditionType: "approval_type",
					operator: "equals",
					value: workflowType,
				}),
			],
		});

		expect(
			findMatchingRoutingPolicy({ ...baseContext, workflowType }, [
				canonicalPolicy,
			])?.id,
		).toBe(canonicalPolicy.id);
		expect(
			findMatchingRoutingPolicy({ ...baseContext, workflowType }, [
				policy({
					conditions: [
						condition({
							conditionType: "approval_type",
							operator: "in",
							values: ["absence_entry", "time_entry", "travel_expense_claim"],
						}),
					],
				}),
			]),
		).toBeNull();
	});

	it("matches a legacy time_entry policy for manual time submission", () => {
		expect(
			findMatchingRoutingPolicy(baseContext, [
				policy({
					conditions: [
						condition({
							conditionType: "approval_type",
							operator: "equals",
							value: "time_entry",
						}),
					],
				}),
			])?.id,
		).toBe("policy_9308152b-648a-488c-a8b3-0ecf0d0507aa");
	});

	it("matches a canonical-specific manual policy only for manual time submission", () => {
		const manualPolicy = policy({
			conditions: [
				condition({
					conditionType: "approval_type",
					operator: "equals",
					value: "manual_time_submission",
				}),
			],
		});

		expect(findMatchingRoutingPolicy(baseContext, [manualPolicy])?.id).toBe(
			manualPolicy.id,
		);
		expect(
			findMatchingRoutingPolicy(
				{ ...baseContext, workflowType: "policy_clock_out" },
				[manualPolicy],
			),
		).toBeNull();
	});

	it("rejects a foreign-organization policy even when all conditions match", () => {
		expect(
			findMatchingRoutingPolicy(baseContext, [
				policy({ organizationId: "org_b6d7cac6-cb11-453f-962c-6c41d0b4c65e" }),
			]),
		).toBeNull();
	});

	it("matches every supported condition and operator", () => {
		const conditions: ApprovalPolicyConditionDraft[] = [
			condition({
				conditionType: "approval_type",
				operator: "in",
				values: ["manual_time_submission"],
			}),
			condition({
				conditionType: "team",
				operator: "equals",
				value: baseContext.teamIds[1],
			}),
			condition({
				conditionType: "team",
				operator: "in",
				values: [
					"team_72ca22e1-c5e0-4c2a-93ba-54619e5dbb39",
					baseContext.teamIds[0],
				],
			}),
			condition({
				conditionType: "location",
				operator: "equals",
				value: baseContext.locationId ?? undefined,
			}),
			condition({
				conditionType: "location",
				operator: "in",
				values: [baseContext.locationId ?? ""],
			}),
			condition({
				conditionType: "absence_category",
				operator: "equals",
				value: baseContext.absenceCategoryId ?? undefined,
			}),
			condition({
				conditionType: "absence_category",
				operator: "in",
				values: [baseContext.absenceCategoryId ?? ""],
			}),
			condition({
				conditionType: "overtime_risk",
				operator: "equals",
				value: baseContext.overtimeRisk ?? undefined,
			}),
			condition({
				conditionType: "overtime_risk",
				operator: "in",
				values: ["none", baseContext.overtimeRisk ?? ""],
			}),
			condition({
				conditionType: "employee_group",
				operator: "equals",
				value: baseContext.employeeGroupIds[0],
			}),
			condition({
				conditionType: "employee_group",
				operator: "in",
				values: [
					"employee_group_314f7795-5387-4a21-8ddd-07756cfecbb1",
					baseContext.employeeGroupIds[0],
				],
			}),
			condition({
				conditionType: "travel_expense_amount",
				operator: "gte",
				amountMin: 750,
			}),
			condition({
				conditionType: "travel_expense_amount",
				operator: "lte",
				amountMax: 750,
			}),
			condition({
				conditionType: "travel_expense_amount",
				operator: "between",
				amountMin: 500,
				amountMax: 750,
			}),
		];

		expect(
			findMatchingRoutingPolicy(baseContext, [policy({ conditions })])?.id,
		).toBe("policy_9308152b-648a-488c-a8b3-0ecf0d0507aa");
	});

	it("selects the lowest-priority matching policy", () => {
		expect(
			findMatchingRoutingPolicy(baseContext, [
				policy({
					id: "policy_7d0f2f2b-b6c7-4d0e-9b65-d04809016f32",
					priority: 20,
				}),
				policy({
					id: "policy_6a1f2a38-a7d1-43a0-b96f-759d2fd03d0f",
					priority: 5,
				}),
			])?.id,
		).toBe("policy_6a1f2a38-a7d1-43a0-b96f-759d2fd03d0f");
	});

	it("uses an active policy with no conditions as a catch-all", () => {
		expect(findMatchingRoutingPolicy(baseContext, [policy()])?.id).toBe(
			"policy_9308152b-648a-488c-a8b3-0ecf0d0507aa",
		);
	});

	it("returns null when no eligible policy matches", () => {
		expect(
			findMatchingRoutingPolicy(baseContext, [
				policy({ isActive: false }),
				policy({
					conditions: [
						condition({
							conditionType: "location",
							operator: "equals",
							value: "location_8bb02da6-ba7e-4c59-9ccf-8073a2d4c4fc",
						}),
					],
				}),
			]),
		).toBeNull();
	});
});

describe("validateRoutingPolicy", () => {
	it.each([
		[
			"a null condition",
			policy({ conditions: [null as unknown as ApprovalPolicyConditionDraft] }),
			"conditions[0]",
		],
		[
			"a null stage",
			policy({ stages: [null as unknown as ApprovalPolicyStageDraft] }),
			"stages[0]",
		],
	])("rejects %s at validation and matching boundaries", (_description, invalidPolicy, field) => {
		expect(() => validateRoutingPolicy(invalidPolicy)).toThrow(
			ApprovalRoutingPolicyValidationError,
		);
		expect(() => validateRoutingPolicy(invalidPolicy)).toThrow(field);
		expect(() =>
			findMatchingRoutingPolicy(baseContext, [invalidPolicy]),
		).toThrow(ApprovalRoutingPolicyValidationError);
		expect(() =>
			findMatchingRoutingPolicy(baseContext, [invalidPolicy]),
		).toThrow(field);
	});

	it.each([
		[
			"an unsupported condition operator",
			policy({
				conditions: [
					{
						conditionType: "team",
						operator: "gte",
					} as ApprovalPolicyConditionDraft,
				],
			}),
			"conditions[0].operator",
		],
		[
			"a missing string condition value",
			policy({
				conditions: [{ conditionType: "location", operator: "equals" }],
			}),
			"conditions[0].value",
		],
		[
			"a missing amount condition bound",
			policy({
				conditions: [
					{
						conditionType: "travel_expense_amount",
						operator: "between",
						amountMin: 100,
					},
				],
			}),
			"conditions[0].amountMax",
		],
	])("rejects %s", (_description, invalidPolicy, field) => {
		expect(() => validateRoutingPolicy(invalidPolicy)).toThrow(
			ApprovalRoutingPolicyValidationError,
		);
		expect(() => validateRoutingPolicy(invalidPolicy)).toThrow(field);
	});

	it("rejects an unknown approval type value", () => {
		const invalidPolicy = policy({
			conditions: [
				{
					conditionType: "approval_type",
					operator: "equals",
					value: "unrecognized_approval_type",
				},
			],
		});

		expect(() => validateRoutingPolicy(invalidPolicy)).toThrow(
			"conditions[0].value",
		);
	});

	it("rejects an unsupported stage fallback", () => {
		const invalidPolicy = policy({
			stages: [stage("manager" as RoutingStageFallback)],
		});

		expect(() => validateRoutingPolicy(invalidPolicy)).toThrow(
			"stages[0].fallbackBehavior",
		);
	});
});

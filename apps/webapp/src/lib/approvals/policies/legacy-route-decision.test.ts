import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/effect/errors";
import { ApprovalRoutingPolicyValidationError } from "../routing/policy-matcher";
import { decideLegacyRoute } from "./legacy-route-decision";
import type {
	ApprovalPolicyDraft,
	ApprovalPolicyEvaluationContext,
} from "./types";

const context: ApprovalPolicyEvaluationContext = {
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
	entityId: "entity_1",
};

const directory = {
	employees: [
		{
			id: "emp_requester",
			organizationId: "org_1",
			isActive: true,
			role: "employee" as const,
		},
		{
			id: "emp_manager",
			organizationId: "org_1",
			isActive: true,
			role: "manager" as const,
		},
		{
			id: "emp_admin",
			organizationId: "org_1",
			isActive: true,
			role: "admin" as const,
		},
	],
	managerLinks: [],
	teamMemberships: [],
	teams: [],
};

const policy: ApprovalPolicyDraft = {
	id: "policy_1",
	organizationId: "org_1",
	name: "Absences",
	isActive: true,
	priority: 10,
	conditions: [
		{
			conditionType: "approval_type",
			operator: "in",
			values: ["absence_entry"],
		},
	],
	stages: [],
};

function stage(
	stepOrder: number,
	approver: Pick<
		ApprovalPolicyDraft["stages"][number],
		"approverType" | "approverEmployeeId"
	>,
): ApprovalPolicyDraft["stages"][number] {
	return {
		id: `stage_${stepOrder}`,
		stepOrder,
		label: `Stage ${stepOrder}`,
		fallbackBehavior: "fail",
		...approver,
	};
}

describe("decideLegacyRoute", () => {
	it("routes to the default approver when no policy matches", () => {
		expect(
			decideLegacyRoute({
				context,
				policies: [],
				defaultApproverId: "emp_manager",
				...directory,
			}),
		).toEqual({
			kind: "default",
			approverEmployeeId: "emp_manager",
			disposition: { kind: "human", approverEmployeeId: "emp_manager" },
		});
	});

	it("auto-approves a requester who is their own default approver", () => {
		expect(
			decideLegacyRoute({
				context,
				policies: [],
				defaultApproverId: "emp_requester",
				...directory,
			}),
		).toMatchObject({
			kind: "default",
			approverEmployeeId: "emp_requester",
			disposition: { kind: "auto_approve", reason: "requester_is_approver" },
		});
	});

	it("fails as submitting does when no policy matches and there is no default approver", () => {
		const decision = decideLegacyRoute({
			context,
			policies: [],
			defaultApproverId: null,
			...directory,
		});

		expect(decision).toMatchObject({
			kind: "failure",
			reason: "no_default_approver",
		});
		expect(decision.kind === "failure" && decision.error).toEqual(
			new ValidationError({
				message: "No manager assigned to approve time changes",
				field: "managerId",
			}),
		);
	});

	it("resolves a matched policy's stages in step order, auto-approving the requester's own stage", () => {
		const stages = [
			stage(3, { approverType: "org_admin" }),
			stage(1, {
				approverType: "specific_employee",
				approverEmployeeId: "emp_requester",
			}),
			stage(2, {
				approverType: "specific_employee",
				approverEmployeeId: "emp_manager",
			}),
		];

		expect(
			decideLegacyRoute({
				context,
				policies: [{ ...policy, stages }],
				defaultApproverId: "emp_manager",
				...directory,
			}),
		).toEqual({
			kind: "policy",
			policy: { ...policy, stages },
			stages: [
				{
					stage: stages[1],
					approverEmployeeId: "emp_requester",
					disposition: {
						kind: "auto_approve",
						reason: "requester_is_approver",
					},
				},
				{
					stage: stages[2],
					approverEmployeeId: "emp_manager",
					disposition: { kind: "human", approverEmployeeId: "emp_manager" },
				},
				{
					stage: stages[0],
					approverEmployeeId: "emp_admin",
					disposition: { kind: "human", approverEmployeeId: "emp_admin" },
				},
			],
			autoCompleted: false,
		});
	});

	it("auto-completes a chain whose every stage resolves to the requester", () => {
		const stages = [
			stage(1, {
				approverType: "specific_employee",
				approverEmployeeId: "emp_requester",
			}),
			stage(2, {
				approverType: "specific_employee",
				approverEmployeeId: "emp_requester",
			}),
		];

		expect(
			decideLegacyRoute({
				context,
				policies: [{ ...policy, stages }],
				defaultApproverId: null,
				...directory,
			}),
		).toMatchObject({ kind: "policy", autoCompleted: true });
	});

	it("fails as submitting does when a stage cannot resolve", () => {
		const stages = [
			stage(1, {
				approverType: "specific_employee",
				approverEmployeeId: "emp_manager",
			}),
			stage(2, { approverType: "manager_manager" }),
		];

		const decision = decideLegacyRoute({
			context,
			policies: [{ ...policy, stages }],
			defaultApproverId: "emp_manager",
			...directory,
		});

		expect(decision).toMatchObject({
			kind: "failure",
			reason: "stage_unresolvable",
			policy: { id: "policy_1" },
			stage: { id: "stage_2" },
		});
		expect(decision.kind === "failure" && decision.error).toEqual(
			new ValidationError({
				message: "Requester has no active direct manager in this organization.",
				field: "approvalPolicyStage.approverType",
				value: "manager_manager",
			}),
		);
	});

	it("fails as submitting does when the matched policy has no stages", () => {
		const decision = decideLegacyRoute({
			context,
			policies: [policy],
			defaultApproverId: "emp_manager",
			...directory,
		});

		expect(decision).toMatchObject({
			kind: "failure",
			reason: "policy_has_no_stages",
			policy: { id: "policy_1" },
		});
		expect(decision.kind === "failure" && decision.error).toEqual(
			new ValidationError({
				message: "Matched approval policy has no stages.",
				field: "approvalPolicy.stages",
				value: "policy_1",
			}),
		);
	});

	it("fails with the matcher's error when the policies are invalid", () => {
		const decision = decideLegacyRoute({
			context,
			policies: [
				{
					...policy,
					conditions: [
						{ conditionType: "team", operator: "in", value: "team_1" },
					],
					stages: [stage(1, { approverType: "org_admin" })],
				},
			],
			defaultApproverId: "emp_manager",
			...directory,
		});

		expect(decision).toMatchObject({
			kind: "failure",
			reason: "invalid_policies",
		});
		expect(decision.kind === "failure" && decision.error).toBeInstanceOf(
			ApprovalRoutingPolicyValidationError,
		);
	});
});

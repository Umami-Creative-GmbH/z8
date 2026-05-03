import { describe, expect, it } from "vitest";
import {
	approveCurrentStageInMemory,
	createChainInMemory,
	rejectCurrentStageInMemory,
} from "./chain-service";
import type { ApprovalPolicyDraft, ApprovalPolicyEvaluationContext } from "./types";

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
	entityId: "absence_1",
};

const policy: ApprovalPolicyDraft = {
	id: "policy_1",
	organizationId: "org_1",
	name: "Two step",
	isActive: true,
	priority: 1,
	conditions: [{ conditionType: "approval_type", operator: "equals", value: "absence_entry" }],
	stages: [
		{
			id: "stage_1",
			stepOrder: 1,
			label: "Manager",
			approverType: "specific_employee",
			approverEmployeeId: "emp_manager",
		},
		{
			id: "stage_2",
			stepOrder: 2,
			label: "Admin",
			approverType: "specific_employee",
			approverEmployeeId: "emp_admin",
		},
	],
};

describe("chain service in-memory model", () => {
	it("creates one current-stage approval request", () => {
		const chain = createChainInMemory({ context, policy });

		expect(chain.status).toBe("pending");
		expect(chain.stages).toHaveLength(2);
		expect(chain.stages[0].status).toBe("pending");
		expect(chain.stages[0].approvalRequestId).toBe("request_stage_1");
		expect(chain.stages[1].approvalRequestId).toBeNull();
	});

	it("advances to the next stage after approval", () => {
		const chain = createChainInMemory({ context, policy });
		const advanced = approveCurrentStageInMemory(chain, "emp_manager");

		expect(advanced.status).toBe("pending");
		expect(advanced.currentStageOrder).toBe(2);
		expect(advanced.stages[0].status).toBe("approved");
		expect(advanced.stages[1].status).toBe("pending");
		expect(advanced.stages[1].approvalRequestId).toBe("request_stage_2");
	});

	it("rejects the chain at the current stage", () => {
		const chain = createChainInMemory({ context, policy });
		const rejected = rejectCurrentStageInMemory(chain, "emp_manager");

		expect(rejected.status).toBe("rejected");
		expect(rejected.stages[0].status).toBe("rejected");
		expect(rejected.stages[1].approvalRequestId).toBeNull();
	});
});

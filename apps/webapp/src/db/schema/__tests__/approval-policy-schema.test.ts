import { describe, expect, it } from "vitest";
import {
	approvalChainInstance,
	approvalChainStageInstance,
	approvalPolicy,
	approvalPolicyCondition,
	approvalPolicyStage,
	employeeGroup,
	employeeGroupMember,
} from "@/db/schema";

describe("approval policy schema exports", () => {
	it("exports policy, group, and chain tables", () => {
		expect(approvalPolicy).toBeDefined();
		expect(approvalPolicyCondition).toBeDefined();
		expect(approvalPolicyStage).toBeDefined();
		expect(employeeGroup).toBeDefined();
		expect(employeeGroupMember).toBeDefined();
		expect(approvalChainInstance).toBeDefined();
		expect(approvalChainStageInstance).toBeDefined();
	});
});

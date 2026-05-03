import { describe, expect, it } from "vitest";
import {
	buildApprovalPolicyPayload,
	defaultApprovalPolicyFormValues,
} from "./approval-policy-dialog";

describe("approval policy dialog helpers", () => {
	it("builds a valid payload for one sequential stage", () => {
		const payload = buildApprovalPolicyPayload({
			...defaultApprovalPolicyFormValues,
			name: "Absence escalation",
			isActive: true,
			priority: "10",
			approvalTypes: ["absence_entry"],
			stages: [
				{ localId: "1", label: "Manager", approverType: "direct_manager", approverEmployeeId: "" },
			],
		});

		expect(payload).toEqual({
			name: "Absence escalation",
			description: "",
			isActive: true,
			priority: 10,
			conditions: [{ conditionType: "approval_type", operator: "in", values: ["absence_entry"] }],
			stages: [{ id: "1", stepOrder: 1, label: "Manager", approverType: "direct_manager" }],
		});
	});

	it("rejects active payloads without stages", () => {
		expect(() =>
			buildApprovalPolicyPayload({
				...defaultApprovalPolicyFormValues,
				name: "Broken",
				isActive: true,
				priority: "1",
				approvalTypes: ["absence_entry"],
				stages: [],
			}),
		).toThrow("Active policies require at least one approval stage.");
	});
});

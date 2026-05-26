import { describe, expect, it } from "vitest";
import {
	approvalTypeOptions,
	buildApprovalPolicyPayload,
	defaultApprovalPolicyFormValues,
} from "./approval-policy-dialog-utils";

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

	it("offers runtime approval type identifiers", () => {
		expect(approvalTypeOptions.map((option) => option.value)).toEqual([
			"absence_entry",
			"time_entry",
			"travel_expense_claim",
		]);
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

	it("builds a valid payload for a specific employee stage", () => {
		const payload = buildApprovalPolicyPayload({
			...defaultApprovalPolicyFormValues,
			name: "Operations escalation",
			priority: "20",
			stages: [
				{
					localId: "1",
					label: "Operations",
					approverType: "specific_employee",
					approverEmployeeId: "employee_1",
				},
			],
		});

		expect(payload.stages).toEqual([
			{
				id: "1",
				stepOrder: 1,
				label: "Operations",
				approverType: "specific_employee",
				approverEmployeeId: "employee_1",
			},
		]);
	});

	it("rejects specific employee stages without an approver employee id", () => {
		expect(() =>
			buildApprovalPolicyPayload({
				...defaultApprovalPolicyFormValues,
				name: "Broken",
				priority: "20",
				stages: [
					{
						localId: "1",
						label: "Operations",
						approverType: "specific_employee",
						approverEmployeeId: "",
					},
				],
			}),
		).toThrow("Specific employee stages require an approver employee ID.");
	});
});

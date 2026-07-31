/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApprovalPolicyDialog } from "./approval-policy-dialog";
import {
	type ApprovalPolicyFormValues,
	approvalTypeOptions,
	buildApprovalPolicyPayload,
	defaultApprovalPolicyFormValues,
} from "./approval-policy-dialog-utils";
import { ApprovalPolicyStagesField } from "./approval-policy-stages-field";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));

describe("approval policy dialog helpers", () => {
	it("clears a stale specific employee ID when the approver changes", () => {
		const handleChange = (stages: ApprovalPolicyFormValues["stages"]) => {
			renderedStages = stages;
		};
		let renderedStages: ApprovalPolicyFormValues["stages"] = [
			{
				localId: "stage-1",
				label: "Operations",
				approverType: "specific_employee",
				approverEmployeeId: "employee_1",
				fallbackBehavior: "fail",
			},
		];

		render(
			<ApprovalPolicyStagesField
				stages={renderedStages}
				onChange={handleChange}
				onAddStage={() => {}}
				t={(key, defaultValue) => defaultValue ?? key}
			/>,
		);

		fireEvent.change(screen.getByLabelText("Approver"), {
			target: { value: "direct_manager" },
		});

		expect(renderedStages[0]?.approverEmployeeId).toBe("");
	});

	it("builds a valid payload for one sequential stage", () => {
		const payload = buildApprovalPolicyPayload({
			...defaultApprovalPolicyFormValues,
			name: "Absence escalation",
			isActive: true,
			priority: "10",
			approvalTypes: ["absence"],
			stages: [
				{
					localId: "1",
					label: "Manager",
					approverType: "direct_manager",
					approverEmployeeId: "",
					fallbackBehavior: "fail",
				},
			],
		});

		expect(payload).toEqual({
			name: "Absence escalation",
			description: "",
			isActive: true,
			priority: 10,
			conditions: [
				{ conditionType: "approval_type", operator: "in", values: ["absence"] },
			],
			stages: [
				{
					id: "1",
					stepOrder: 1,
					label: "Manager",
					approverType: "direct_manager",
					fallbackBehavior: "fail",
				},
			],
		});
	});

	it("serializes manual time submissions with a default-manager fallback", () => {
		const payload = buildApprovalPolicyPayload({
			...defaultApprovalPolicyFormValues,
			name: "Manual submission review",
			priority: "10",
			approvalTypes: ["manual_time_submission"],
			stages: [
				{
					localId: "1",
					label: "Manager",
					approverType: "direct_manager",
					approverEmployeeId: "",
					fallbackBehavior: "default_manager",
				},
			],
		});

		expect(payload.conditions[0]?.values).toEqual(["manual_time_submission"]);
		expect(payload.stages[0]?.fallbackBehavior).toBe("default_manager");
	});

	it("offers only canonical approval workflow types", () => {
		expect(approvalTypeOptions.map((option) => option.value)).toEqual([
			"absence",
			"time_correction",
			"manual_time_submission",
			"policy_clock_out",
			"travel_expense",
			"shift_request",
			"compliance_exception",
		]);
	});

	it("shows canonical dialog labels without legacy approval labels", () => {
		render(
			<ApprovalPolicyDialog
				open
				onOpenChange={() => {}}
				onSubmit={async () => {}}
			/>,
		);

		expect(screen.getByLabelText("Manual time submission")).toBeTruthy();
		expect(screen.getByLabelText("Compliance exception")).toBeTruthy();
		expect(screen.queryByLabelText("Absence requests")).toBeNull();
		expect(screen.queryByLabelText("Time entry changes")).toBeNull();
	});

	it("adds stages with a fail fallback", () => {
		vi.stubGlobal("crypto", { randomUUID: () => "stage-1" });

		try {
			render(
				<ApprovalPolicyDialog
					open
					onOpenChange={() => {}}
					onSubmit={async () => {}}
				/>,
			);

			fireEvent.click(screen.getByRole("button", { name: "Add stage" }));

			expect(
				(screen.getByLabelText("Fallback behavior") as HTMLSelectElement).value,
			).toBe("fail");
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("shows a fallback selector and updates the selected behavior", () => {
		let renderedStages: ApprovalPolicyFormValues["stages"] = [
			{
				localId: "stage-1",
				label: "Operations",
				approverType: "direct_manager",
				approverEmployeeId: "",
				fallbackBehavior: "fail",
			},
		];

		render(
			<ApprovalPolicyStagesField
				stages={renderedStages}
				onChange={(stages) => {
					renderedStages = stages;
				}}
				onAddStage={() => {}}
				t={(_key, defaultValue) => defaultValue ?? ""}
			/>,
		);

		fireEvent.change(screen.getByLabelText("Fallback behavior"), {
			target: { value: "organization_admin" },
		});

		expect(renderedStages[0]?.fallbackBehavior).toBe("organization_admin");
		expect(
			buildApprovalPolicyPayload({
				...defaultApprovalPolicyFormValues,
				name: "Operations escalation",
				priority: "10",
				stages: renderedStages,
			}).stages[0]?.fallbackBehavior,
		).toBe("organization_admin");
	});

	it("rejects active payloads without stages", () => {
		expect(() =>
			buildApprovalPolicyPayload({
				...defaultApprovalPolicyFormValues,
				name: "Broken",
				isActive: true,
				priority: "1",
				approvalTypes: ["absence"],
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
					fallbackBehavior: "fail",
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
				fallbackBehavior: "fail",
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
						fallbackBehavior: "fail",
					},
				],
			}),
		).toThrow("Specific employee stages require an approver employee ID.");
	});
});

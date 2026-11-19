/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalPolicyDialog } from "./approval-policy-dialog";
import {
	type ApprovalPolicyFormValues,
	type ApprovalPolicyRecord,
	approvalPolicyToEditState,
	approvalTypeOptions,
	buildApprovalPolicyPayload,
	defaultApprovalPolicyFormValues,
} from "./approval-policy-dialog-utils";
import { ApprovalPolicyStagesField } from "./approval-policy-stages-field";
import type { ApproverEmployeeResolution } from "./use-approver-employees";

const lookup = vi.hoisted(() => ({
	resolve: vi.fn(
		(_employeeId: string): ApproverEmployeeResolution => ({ status: "unknown" }),
	),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (
			_key: string,
			defaultValue?: string,
			params?: Record<string, string | number>,
		) => {
			let text = defaultValue ?? _key;
			for (const [name, value] of Object.entries(params ?? {})) {
				text = text.replace(`{${name}}`, String(value));
			}
			return text;
		},
	}),
}));

vi.mock("./use-approver-employees", () => ({
	useApproverEmployees: () => lookup.resolve,
}));

vi.mock("@/components/employee-select/employee-select-field", () => ({
	EmployeeSingleSelect: ({
		label,
		value,
		placeholder,
		onChange,
	}: {
		label: string;
		value: string | null;
		placeholder?: string;
		onChange: (value: string | null) => void;
	}) => (
		<div>
			<span>{label}</span>
			<span data-testid="employee-trigger">{placeholder}</span>
			<span data-testid="employee-value">{value ?? ""}</span>
			<button type="button" onClick={() => onChange("employee-picked")}>
				Pick employee
			</button>
		</div>
	),
}));

const t = (
	_key: string,
	defaultValue?: string,
	params?: Record<string, string | number>,
) => {
	let text = defaultValue ?? _key;
	for (const [name, value] of Object.entries(params ?? {})) {
		text = text.replace(`{${name}}`, String(value));
	}
	return text;
};

const storedPolicy: ApprovalPolicyRecord = {
	id: "policy-1",
	name: "Absence escalation",
	description: null,
	isActive: true,
	priority: 20,
	conditions: [
		{
			conditionType: "approval_type",
			operator: "in",
			valueJson: { values: ["absence", "absence_entry"] },
			amountMin: null,
			amountMax: null,
		},
		{
			conditionType: "team",
			operator: "equals",
			valueJson: null,
			amountMin: null,
			amountMax: null,
			teamId: "team-1",
		},
		{
			conditionType: "travel_expense_amount",
			operator: "gte",
			valueJson: {},
			amountMin: "500.00",
			amountMax: null,
		},
	],
	stages: [
		{
			id: "stage-b",
			stepOrder: 2,
			label: "Operations",
			approverType: "specific_employee",
			approverEmployeeId: "abcdef12-3456-7890",
			fallbackBehavior: "organization_admin",
		},
		{
			id: "stage-a",
			stepOrder: 1,
			label: "Manager",
			approverType: "direct_manager",
			approverEmployeeId: null,
			fallbackBehavior: "fail",
		},
	],
};

beforeEach(() => {
	lookup.resolve.mockImplementation(() => ({ status: "unknown" }));
});

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
			"period_submission",
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

	it("chooses a specific approver from the employee picker and stores the employee id", () => {
		let renderedStages: ApprovalPolicyFormValues["stages"] = [
			{
				localId: "stage-1",
				label: "Operations",
				approverType: "specific_employee",
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
				t={t}
			/>,
		);

		expect(screen.queryByPlaceholderText("Example: employee_123…")).toBeNull();
		expect(screen.getByText("Approving employee")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Pick employee" }));
		expect(renderedStages[0]?.approverEmployeeId).toBe("employee-picked");
	});

	it("names a stored approver that no longer resolves as an unknown employee", () => {
		render(
			<ApprovalPolicyStagesField
				stages={[
					{
						localId: "stage-1",
						label: "Operations",
						approverType: "specific_employee",
						approverEmployeeId: "abcdef12-3456-7890",
						fallbackBehavior: "fail",
					},
				]}
				onChange={() => {}}
				onAddStage={() => {}}
				approverLookup={() => ({ status: "unknown" })}
				t={t}
			/>,
		);

		expect(screen.getByTestId("employee-trigger").textContent).toBe(
			"Unknown employee (abcdef12)",
		);
		expect(screen.getByTestId("employee-value").textContent).toBe(
			"abcdef12-3456-7890",
		);
	});
});

describe("editing a stored approval policy", () => {
	it("loads the editable fields and keeps everything the editor cannot change", () => {
		const state = approvalPolicyToEditState(storedPolicy);

		expect(state.id).toBe("policy-1");
		expect(state.values).toMatchObject({
			name: "Absence escalation",
			description: "",
			isActive: true,
			priority: "20",
			approvalTypes: ["absence"],
		});
		expect(state.values.stages.map((stage) => stage.localId)).toEqual([
			"stage-a",
			"stage-b",
		]);
		expect(state.values.stages[1]).toMatchObject({
			approverType: "specific_employee",
			approverEmployeeId: "abcdef12-3456-7890",
			fallbackBehavior: "organization_admin",
		});
		expect(state.legacyApprovalTypes).toEqual(["absence_entry"]);
		expect(state.preservedConditions).toEqual([
			{ conditionType: "team", operator: "equals", value: "team-1" },
			{ conditionType: "travel_expense_amount", operator: "gte", amountMin: 500 },
		]);

		const payload = buildApprovalPolicyPayload(state.values, undefined, {
			preservedConditions: state.preservedConditions,
			legacyApprovalTypes: state.legacyApprovalTypes,
		});
		expect(payload.conditions).toEqual([
			{
				conditionType: "approval_type",
				operator: "in",
				values: ["absence", "absence_entry"],
			},
			{ conditionType: "team", operator: "equals", value: "team-1" },
			{ conditionType: "travel_expense_amount", operator: "gte", amountMin: 500 },
		]);
	});

	it("prefills the edit form and saves the same policy id", async () => {
		const onSubmit = vi.fn().mockResolvedValue(undefined);
		render(
			<ApprovalPolicyDialog
				open
				onOpenChange={() => {}}
				policy={approvalPolicyToEditState(storedPolicy)}
				onSubmit={onSubmit}
			/>,
		);

		expect(screen.getByText("Edit approval policy")).toBeTruthy();
		expect(
			(screen.getByRole("textbox", { name: /Name/ }) as HTMLInputElement).value,
		).toBe("Absence escalation");
		expect(screen.getByText(/that can't be changed here/)).toBeTruthy();
		expect(screen.getByText(/older approval type/)).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Save policy" }));

		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
		expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
			id: "policy-1",
			name: "Absence escalation",
			isActive: true,
			stages: [
				{ id: "stage-a", stepOrder: 1, approverType: "direct_manager" },
				{
					id: "stage-b",
					stepOrder: 2,
					approverType: "specific_employee",
					approverEmployeeId: "abcdef12-3456-7890",
				},
			],
		});
		expect(onSubmit.mock.calls[0]?.[0].conditions).toHaveLength(3);
	});
});

describe("live approval chain preview", () => {
	it("shows the stages being drafted, with resolved approver names", () => {
		vi.stubGlobal("crypto", { randomUUID: () => "stage-1" });
		lookup.resolve.mockImplementation((employeeId) =>
			employeeId === "abcdef12-3456-7890"
				? { status: "resolved", name: "Grace Hopper" }
				: { status: "unknown" },
		);

		try {
			const { unmount } = render(
				<ApprovalPolicyDialog
					open
					onOpenChange={() => {}}
					onSubmit={async () => {}}
				/>,
			);
			const preview = () =>
				screen.getByRole("region", { name: "Approval chain preview" });

			expect(preview().textContent).toContain(
				"Add a stage to see the approval chain.",
			);
			fireEvent.click(screen.getByRole("button", { name: "Add stage" }));
			expect(preview().textContent).toContain("Stage 1 · Manager review");
			expect(preview().textContent).toContain("Direct manager");
			expect(preview().textContent).toContain(
				"If no approver is found: Fail request",
			);
			unmount();

			render(
				<ApprovalPolicyDialog
					open
					onOpenChange={() => {}}
					policy={approvalPolicyToEditState(storedPolicy)}
					onSubmit={async () => {}}
				/>,
			);
			expect(preview().textContent).toContain("Stage 2 · Operations");
			expect(preview().textContent).toContain("Grace Hopper");
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

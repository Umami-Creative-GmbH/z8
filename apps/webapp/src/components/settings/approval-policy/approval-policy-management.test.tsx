/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalPolicyManagement } from "./approval-policy-management";

const mocks = vi.hoisted(() => ({
	getApprovalPolicies: vi.fn(),
	upsertApprovalPolicy: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
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

vi.mock("@/app/[locale]/(app)/settings/approval-policies/actions", () => ({
	getApprovalPolicies: mocks.getApprovalPolicies,
	upsertApprovalPolicy: mocks.upsertApprovalPolicy,
}));

vi.mock("./use-approver-employees", () => ({
	useApproverEmployees: () => () => ({ status: "pending" }),
}));

vi.mock("@/components/employee-select/employee-select-field", () => ({
	EmployeeSingleSelect: () => null,
}));

vi.mock("sonner", () => ({
	toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

const policy = {
	id: "policy-1",
	organizationId: "org-1",
	name: "Travel approvals",
	description: "Large trips",
	isActive: true,
	priority: 10,
	conditions: [
		{
			id: "condition-1",
			conditionType: "approval_type",
			operator: "in",
			valueJson: { values: ["travel_expense"] },
			amountMin: null,
			amountMax: null,
		},
		{
			id: "condition-2",
			conditionType: "travel_expense_amount",
			operator: "gte",
			valueJson: {},
			amountMin: "1000.00",
			amountMax: null,
		},
	],
	stages: [
		{
			id: "stage-1",
			stepOrder: 1,
			label: "Manager",
			approverType: "direct_manager",
			approverEmployeeId: null,
			fallbackBehavior: "fail",
		},
	],
};

function renderManagement() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<ApprovalPolicyManagement organizationId="org-1" />
		</QueryClientProvider>,
	);
}

describe("ApprovalPolicyManagement", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getApprovalPolicies.mockResolvedValue({ success: true, data: [policy] });
		mocks.upsertApprovalPolicy.mockResolvedValue({ success: true, data: undefined });
	});

	it("no longer shows a static demo chain on the page", async () => {
		renderManagement();
		await screen.findByText("Travel approvals");

		expect(screen.queryByText("Preview chain summary")).toBeNull();
		expect(screen.queryByText("Preview shell")).toBeNull();
	});

	it("opens the policy in the editor with its values", async () => {
		renderManagement();

		fireEvent.click(
			await screen.findByRole("button", { name: "Edit Travel approvals" }),
		);

		expect(await screen.findByText("Edit approval policy")).toBeTruthy();
		expect(
			(screen.getByRole("textbox", { name: /Name/ }) as HTMLInputElement).value,
		).toBe("Travel approvals");
		fireEvent.click(screen.getByRole("button", { name: "Save policy" }));

		await waitFor(() => expect(mocks.upsertApprovalPolicy).toHaveBeenCalledTimes(1));
		expect(mocks.upsertApprovalPolicy.mock.calls[0]?.[0]).toMatchObject({
			id: "policy-1",
			conditions: [
				{ conditionType: "approval_type", operator: "in", values: ["travel_expense"] },
				{ conditionType: "travel_expense_amount", operator: "gte", amountMin: 1000 },
			],
		});
		await waitFor(() =>
			expect(mocks.toastSuccess).toHaveBeenCalledWith("Approval policy saved"),
		);
	});

	it("deactivates a policy only after a confirmation naming it, and offers undo", async () => {
		renderManagement();

		fireEvent.click(
			await screen.findByRole("button", { name: "Deactivate Travel approvals" }),
		);
		expect(await screen.findByText("Deactivate “Travel approvals”?")).toBeTruthy();
		expect(mocks.upsertApprovalPolicy).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));

		await waitFor(() => expect(mocks.upsertApprovalPolicy).toHaveBeenCalledTimes(1));
		expect(mocks.upsertApprovalPolicy.mock.calls[0]?.[0]).toMatchObject({
			id: "policy-1",
			name: "Travel approvals",
			description: "Large trips",
			isActive: false,
			priority: 10,
			stages: [{ label: "Manager", approverType: "direct_manager" }],
		});
		expect(mocks.upsertApprovalPolicy.mock.calls[0]?.[0].conditions).toHaveLength(2);

		await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
		const [message, options] = mocks.toastSuccess.mock.calls[0] ?? [];
		expect(message).toBe("“Travel approvals” deactivated");
		options.action.onClick();
		await waitFor(() => expect(mocks.upsertApprovalPolicy).toHaveBeenCalledTimes(2));
		expect(mocks.upsertApprovalPolicy.mock.calls[1]?.[0]).toMatchObject({
			id: "policy-1",
			isActive: true,
		});
	});

	it("keeps the policy unchanged when the deactivation is cancelled", async () => {
		renderManagement();

		fireEvent.click(
			await screen.findByRole("button", { name: "Deactivate Travel approvals" }),
		);
		fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

		await waitFor(() =>
			expect(screen.queryByText("Deactivate “Travel approvals”?")).toBeNull(),
		);
		expect(mocks.upsertApprovalPolicy).not.toHaveBeenCalled();
	});
});

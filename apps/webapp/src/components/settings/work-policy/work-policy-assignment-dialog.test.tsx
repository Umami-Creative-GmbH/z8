/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createWorkPolicyAssignment,
	getTeamsForAssignment,
	getWorkPolicies,
} from "@/app/[locale]/(app)/settings/work-policies/actions";
import { WorkPolicyAssignmentDialog } from "./work-policy-assignment-dialog";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/app/[locale]/(app)/settings/work-policies/actions", () => ({
	createWorkPolicyAssignment: vi.fn(),
	getTeamsForAssignment: vi.fn(),
	getWorkPolicies: vi.fn(),
}));

vi.mock("@/components/employee-select", () => ({
	EmployeeSingleSelect: ({ label, error }: { label: string; error?: string }) => (
		<div>
			<span>{label}</span>
			{error ? <p role="alert">{error}</p> : null}
		</div>
	),
}));

beforeAll(() => {
	global.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
	Element.prototype.hasPointerCapture = vi.fn(() => false);
	Element.prototype.setPointerCapture = vi.fn();
	Element.prototype.releasePointerCapture = vi.fn();
	Element.prototype.scrollIntoView = vi.fn();
});

function renderDialog(children: ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

describe("WorkPolicyAssignmentDialog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getWorkPolicies).mockResolvedValue({
			success: true,
			data: [{ id: "policy-1", name: "Retail 38h" }],
		} as never);
		vi.mocked(getTeamsForAssignment).mockResolvedValue({
			success: true,
			data: [{ id: "team-1", name: "Warehouse" }],
		} as never);
		vi.mocked(createWorkPolicyAssignment).mockResolvedValue({
			success: true,
			data: {},
		} as never);
	});

	it("shows each missing choice beside its field instead of submitting", async () => {
		const user = userEvent.setup();
		renderDialog(
			<WorkPolicyAssignmentDialog
				open
				onOpenChange={vi.fn()}
				organizationId="org-1"
				assignmentType="team"
				onSuccess={vi.fn()}
			/>,
		);

		const assign = await screen.findByRole("button", { name: "Assign" });
		await waitFor(() => expect(assign).toHaveProperty("disabled", false));
		await user.click(assign);

		const messages = await screen.findAllByRole("alert");
		expect(messages.map((message) => message.textContent)).toEqual([
			"Select a policy to assign",
			"Select a team",
		]);
		expect(createWorkPolicyAssignment).not.toHaveBeenCalled();
	});

	it("assigns the chosen policy to the chosen team", async () => {
		const user = userEvent.setup();
		const onOpenChange = vi.fn();
		renderDialog(
			<WorkPolicyAssignmentDialog
				open
				onOpenChange={onOpenChange}
				organizationId="org-1"
				assignmentType="team"
				onSuccess={vi.fn()}
			/>,
		);

		await waitFor(() => expect(getTeamsForAssignment).toHaveBeenCalled());
		await user.click(screen.getByRole("combobox", { name: "Policy" }));
		await user.click(await screen.findByRole("option", { name: "Retail 38h" }));
		await user.click(screen.getByRole("combobox", { name: "Team" }));
		await user.click(await screen.findByRole("option", { name: "Warehouse" }));
		await user.click(screen.getByRole("button", { name: "Assign" }));

		await waitFor(() =>
			expect(createWorkPolicyAssignment).toHaveBeenCalledWith({
				policyId: "policy-1",
				assignmentType: "team",
				teamId: "team-1",
				employeeId: undefined,
			}),
		);
		expect(createWorkPolicyAssignment).toHaveBeenCalledTimes(1);
		await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
	});

	it("explains a failed policy load and retries it", async () => {
		const user = userEvent.setup();
		vi.mocked(getWorkPolicies)
			.mockResolvedValueOnce({ success: false, error: "boom" } as never)
			.mockResolvedValue({ success: true, data: [] } as never);

		renderDialog(
			<WorkPolicyAssignmentDialog
				open
				onOpenChange={vi.fn()}
				organizationId="org-1"
				assignmentType="organization"
				onSuccess={vi.fn()}
			/>,
		);

		expect(await screen.findByText("Policies could not be loaded.")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Retry" }));
		await waitFor(() => expect(getWorkPolicies).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(screen.queryByText("Policies could not be loaded.")).toBeNull());
	});
});

// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalInboxItem } from "@/lib/approvals/inbox/types";
import { ApprovalSprintPanel } from "./approval-sprint-panel";

const approveMutation = vi.fn();
const rejectMutation = vi.fn();

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/query/use-approval-inbox", () => ({
	useApproveApproval: () => ({ isPending: false, mutateAsync: approveMutation }),
	useRejectApproval: () => ({ isPending: false, mutateAsync: rejectMutation }),
}));

function createApproval(
	id: string,
	requesterName: string,
	title: string,
	capabilities: Partial<ApprovalInboxItem["capabilities"]> = {},
): ApprovalInboxItem {
	return {
		id,
		type: "absence_entry",
		entityId: `entity-${id}`,
		status: "pending",
		requester: {
			id: `employee-${id}`,
			name: requesterName,
			email: `${id}@example.com`,
			image: null,
			teamId: null,
		},
		summary: {
			title,
			subtitle: "May 2026",
			detail: `${title} summary`,
			badge: null,
		},
		timing: {
			createdAt: "2026-05-01T00:00:00.000Z",
			resolvedAt: null,
			slaDeadline: null,
			ageDays: 1,
		},
		triage: {
			priority: "normal",
			riskLevel: "medium",
			riskReasons: ["needs_review"],
			fastLaneGroup: null,
			isPayrollRelevant: false,
			explanation: "Needs manager review.",
		},
		capabilities: {
			canApprove: true,
			canReject: true,
			canBulkApprove: true,
			requiresRejectReason: true,
			...capabilities,
		},
	};
}

const approvals = [
	createApproval("approval-1", "Ada Lovelace", "Vacation request"),
	createApproval("approval-2", "Grace Hopper", "Time correction"),
];

const threeApprovals = [
	...approvals,
	createApproval("approval-3", "Katherine Johnson", "Expense review"),
];

describe("ApprovalSprintPanel", () => {
	beforeEach(() => {
		approveMutation.mockReset();
		rejectMutation.mockReset();
	});

	it("advances to the next approval after successful approval", async () => {
		approveMutation.mockResolvedValue({ success: true });
		const onActioned = vi.fn();

		render(
			<ApprovalSprintPanel
				open={true}
				items={approvals}
				onOpenChange={vi.fn()}
				onActioned={onActioned}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Approve current approval" }));

		await waitFor(() => expect(screen.getByText("Time correction")).toBeTruthy());
		expect(approveMutation).toHaveBeenCalledWith("approval-1");
		expect(onActioned).toHaveBeenCalledTimes(1);
	});

	it("does not advance when approve returns an error result", async () => {
		approveMutation.mockResolvedValue({ success: false, error: "Policy conflict" });

		render(
			<ApprovalSprintPanel
				open={true}
				items={approvals}
				onOpenChange={vi.fn()}
				onActioned={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Approve current approval" }));

		await waitFor(() => expect(approveMutation).toHaveBeenCalledWith("approval-1"));
		expect(screen.getByText("Vacation request")).toBeTruthy();
		expect(screen.queryByText("Time correction")).toBeNull();
	});

	it("skip advances locally without calling approve or reject mutations", () => {
		render(
			<ApprovalSprintPanel
				open={true}
				items={approvals}
				onOpenChange={vi.fn()}
				onActioned={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Skip current approval" }));

		expect(screen.getByText("Time correction")).toBeTruthy();
		expect(approveMutation).not.toHaveBeenCalled();
		expect(rejectMutation).not.toHaveBeenCalled();
	});

	it("keeps the final approval visible when skipping the last item", () => {
		render(
			<ApprovalSprintPanel
				open={true}
				items={approvals}
				onOpenChange={vi.fn()}
				onActioned={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Skip current approval" }));
		fireEvent.click(screen.getByRole("button", { name: "Skip current approval" }));

		expect(screen.getByText("Time correction")).toBeTruthy();
		expect(screen.queryByText("Sprint complete")).toBeNull();
		expect(approveMutation).not.toHaveBeenCalled();
		expect(rejectMutation).not.toHaveBeenCalled();
	});

	it("handles approve and skip keyboard shortcuts", async () => {
		approveMutation.mockResolvedValue({ success: true });

		render(
			<ApprovalSprintPanel
				open={true}
				items={approvals}
				onOpenChange={vi.fn()}
				onActioned={vi.fn()}
			/>,
		);

		fireEvent.keyDown(window, { key: "a" });

		await waitFor(() => expect(approveMutation).toHaveBeenCalledWith("approval-1"));
		await waitFor(() => expect(screen.getByText("Time correction")).toBeTruthy());

		fireEvent.keyDown(window, { key: "s" });

		expect(screen.getByText("Time correction")).toBeTruthy();
		expect(screen.queryByText("Sprint complete")).toBeNull();
		expect(approveMutation).toHaveBeenCalledTimes(1);
		expect(rejectMutation).not.toHaveBeenCalled();
	});

	it("disables approve button and shortcut when approval cannot be approved", () => {
		const cannotApprove = [
			createApproval("approval-1", "Ada Lovelace", "Vacation request", { canApprove: false }),
		];

		render(
			<ApprovalSprintPanel
				open={true}
				items={cannotApprove}
				onOpenChange={vi.fn()}
				onActioned={vi.fn()}
			/>,
		);

		const approveButton = screen.getByRole("button", { name: "Approve current approval" });
		expect(approveButton).toHaveProperty("disabled", true);
		expect(screen.getByText("Approval unavailable")).toBeTruthy();

		fireEvent.click(approveButton);
		fireEvent.keyDown(window, { key: "a" });

		expect(approveMutation).not.toHaveBeenCalled();
	});

	it("rejects the current approval with the keyboard shortcut and typed reason", async () => {
		rejectMutation.mockResolvedValue({ success: true });

		render(
			<ApprovalSprintPanel
				open={true}
				items={approvals}
				onOpenChange={vi.fn()}
				onActioned={vi.fn()}
			/>,
		);

		fireEvent.keyDown(window, { key: "r" });
		fireEvent.change(screen.getByLabelText("Reason for rejection"), {
			target: { value: "Not enough detail" },
		});
		fireEvent.keyDown(window, { key: "r" });

		await waitFor(() =>
			expect(rejectMutation).toHaveBeenCalledWith({
				approvalId: "approval-1",
				reason: "Not enough detail",
			}),
		);
	});

	it("disables reject button and shortcut when approval cannot be rejected", () => {
		const cannotReject = [
			createApproval("approval-1", "Ada Lovelace", "Vacation request", { canReject: false }),
		];

		render(
			<ApprovalSprintPanel
				open={true}
				items={cannotReject}
				onOpenChange={vi.fn()}
				onActioned={vi.fn()}
			/>,
		);

		const rejectButton = screen.getByRole("button", { name: "Reject current approval" });
		expect(rejectButton).toHaveProperty("disabled", true);
		expect(screen.getByText("Rejection unavailable")).toBeTruthy();

		fireEvent.click(rejectButton);
		fireEvent.keyDown(window, { key: "r" });

		expect(screen.queryByLabelText("Reason for rejection")).toBeNull();
		expect(rejectMutation).not.toHaveBeenCalled();
	});

	it("does not reject with keyboard shortcut when reason is blank", () => {
		render(
			<ApprovalSprintPanel
				open={true}
				items={approvals}
				onOpenChange={vi.fn()}
				onActioned={vi.fn()}
			/>,
		);

		fireEvent.keyDown(window, { key: "r" });
		fireEvent.keyDown(window, { key: "r" });

		expect(screen.getByLabelText("Reason for rejection")).toBeTruthy();
		expect(rejectMutation).not.toHaveBeenCalled();
	});

	it("ignores keyboard shortcuts while typing a rejection reason", () => {
		render(
			<ApprovalSprintPanel
				open={true}
				items={approvals}
				onOpenChange={vi.fn()}
				onActioned={vi.fn()}
			/>,
		);

		fireEvent.keyDown(window, { key: "r" });

		expect(screen.getByLabelText("Reason for rejection")).toBeTruthy();

		fireEvent.focus(screen.getByLabelText("Reason for rejection"));
		fireEvent.keyDown(window, { key: "a" });
		fireEvent.keyDown(window, { key: "s" });

		expect(screen.getByText("Vacation request")).toBeTruthy();
		expect(approveMutation).not.toHaveBeenCalled();
		expect(rejectMutation).not.toHaveBeenCalled();
	});

	it("disables keyboard shortcuts when parent disables shortcuts", () => {
		render(
			<ApprovalSprintPanel
				open={true}
				items={approvals}
				onOpenChange={vi.fn()}
				onActioned={vi.fn()}
				shortcutsEnabled={false}
			/>,
		);

		fireEvent.keyDown(window, { key: "a" });
		fireEvent.keyDown(window, { key: "r" });
		fireEvent.keyDown(window, { key: "s" });
		fireEvent.keyDown(window, { key: "n" });

		expect(screen.getByText("Vacation request")).toBeTruthy();
		expect(screen.queryByLabelText("Reason for rejection")).toBeNull();
		expect(approveMutation).not.toHaveBeenCalled();
		expect(rejectMutation).not.toHaveBeenCalled();
	});

	it("ignores keyboard shortcuts from editable targets", () => {
		render(
			<ApprovalSprintPanel
				open={true}
				items={approvals}
				onOpenChange={vi.fn()}
				onActioned={vi.fn()}
			/>,
		);
		const input = document.createElement("input");
		document.body.appendChild(input);
		fireEvent.focus(input);

		fireEvent.keyDown(input, { key: "a" });
		fireEvent.keyDown(input, { key: "r" });
		fireEvent.keyDown(input, { key: "s" });

		expect(screen.getByText("Vacation request")).toBeTruthy();
		expect(screen.queryByLabelText("Reason for rejection")).toBeNull();
		expect(approveMutation).not.toHaveBeenCalled();

		input.remove();
	});

	it("does not reset to the first approval when open dialog items update", () => {
		const { rerender } = render(
			<ApprovalSprintPanel
				open={true}
				items={threeApprovals}
				onOpenChange={vi.fn()}
				onActioned={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Skip current approval" }));
		fireEvent.click(screen.getByRole("button", { name: "Skip current approval" }));
		expect(screen.getByText("Expense review")).toBeTruthy();

		rerender(
			<ApprovalSprintPanel
				open={true}
				items={approvals}
				onOpenChange={vi.fn()}
				onActioned={vi.fn()}
			/>,
		);

		expect(screen.getByText("Time correction")).toBeTruthy();
		expect(screen.queryByText("Vacation request")).toBeNull();
	});

	it("ignores duplicate rapid approve submissions for the current approval", async () => {
		let resolveApproval: (value: { success: true }) => void = () => undefined;
		let triggeredDuplicate = false;
		approveMutation.mockImplementation(() => {
			if (!triggeredDuplicate) {
				triggeredDuplicate = true;
				fireEvent.keyDown(window, { key: "a" });
			}

			return new Promise((resolve) => {
				resolveApproval = resolve;
			});
		});

		render(
			<ApprovalSprintPanel
				open={true}
				items={approvals}
				onOpenChange={vi.fn()}
				onActioned={vi.fn()}
			/>,
		);

		const approveButton = screen.getByRole("button", { name: "Approve current approval" });
		fireEvent.click(approveButton);

		expect(approveMutation).toHaveBeenCalledTimes(1);

		resolveApproval({ success: true });

		await waitFor(() => expect(screen.getByText("Time correction")).toBeTruthy());
	});

	it("ignores skip keyboard shortcuts while approval is submitting", async () => {
		let resolveApproval: (value: { success: true }) => void = () => undefined;
		approveMutation.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveApproval = resolve;
				}),
		);

		render(
			<ApprovalSprintPanel
				open={true}
				items={approvals}
				onOpenChange={vi.fn()}
				onActioned={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Approve current approval" }));
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Skip current approval" }).hasAttribute("disabled"),
			).toBe(true),
		);

		fireEvent.keyDown(window, { key: "s" });
		fireEvent.keyDown(window, { key: "n" });

		expect(screen.getByText("Vacation request")).toBeTruthy();
		expect(screen.queryByText("Time correction")).toBeNull();

		await act(async () => {
			resolveApproval({ success: true });
		});

		await waitFor(() => expect(screen.getByText("Time correction")).toBeTruthy());
	});

	it("shows the next logical approval when parent removes the approved item", async () => {
		approveMutation.mockResolvedValue({ success: true });

		function ParentControlledSprint() {
			const [items, setItems] = useState(threeApprovals);

			return (
				<ApprovalSprintPanel
					open={true}
					items={items}
					onOpenChange={vi.fn()}
					onActioned={() => setItems((currentItems) => currentItems.slice(1))}
				/>
			);
		}

		render(<ParentControlledSprint />);

		fireEvent.click(screen.getByRole("button", { name: "Approve current approval" }));

		await waitFor(() => expect(screen.getByText("Time correction")).toBeTruthy());
		expect(screen.queryByText("Expense review")).toBeNull();
	});
});

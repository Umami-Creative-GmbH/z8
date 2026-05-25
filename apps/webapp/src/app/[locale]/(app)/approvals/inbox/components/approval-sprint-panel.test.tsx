// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TriagedApprovalItem } from "@/lib/approvals/triage";
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

function createApproval(id: string, requesterName: string, title: string): TriagedApprovalItem {
	return {
		id,
		approvalType: "absence_entry",
		entityId: `entity-${id}`,
		typeName: "Absence Request",
		requester: {
			id: `employee-${id}`,
			userId: `user-${id}`,
			name: requesterName,
			email: `${id}@example.com`,
			image: null,
			teamId: null,
		},
		approverId: "manager-1",
		organizationId: "org-1",
		status: "pending",
		createdAt: new Date("2026-05-01T00:00:00.000Z"),
		resolvedAt: null,
		priority: "normal",
		sla: { deadline: null, status: "on_time", hoursRemaining: null },
		display: {
			title,
			subtitle: "May 2026",
			summary: `${title} summary`,
		},
		triage: {
			riskLevel: "medium",
			riskReasons: ["needs_review"],
			fastLaneGroup: null,
			isPayrollRelevant: false,
			ageDays: 1,
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

		await waitFor(() => expect(screen.getByText("Time correction")).toBeTruthy());
		expect(approveMutation).toHaveBeenCalledWith("approval-1");

		fireEvent.keyDown(window, { key: "s" });

		expect(screen.getByText("Sprint complete")).toBeTruthy();
		expect(approveMutation).toHaveBeenCalledTimes(1);
		expect(rejectMutation).not.toHaveBeenCalled();
	});

	it("disables keyboard shortcut handling while reject reason UI is open", () => {
		render(
			<ApprovalSprintPanel
				open={true}
				items={approvals}
				onOpenChange={vi.fn()}
				onActioned={vi.fn()}
			/>,
		);

		fireEvent.keyDown(window, { key: "r" });

		expect(screen.getByLabelText("Sprint reject reason")).toBeTruthy();

		fireEvent.keyDown(window, { key: "a" });
		fireEvent.keyDown(window, { key: "s" });

		expect(screen.getByText("Vacation request")).toBeTruthy();
		expect(approveMutation).not.toHaveBeenCalled();
		expect(rejectMutation).not.toHaveBeenCalled();
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
});

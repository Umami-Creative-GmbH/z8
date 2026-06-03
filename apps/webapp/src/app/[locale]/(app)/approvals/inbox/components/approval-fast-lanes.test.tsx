// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApprovalInboxFastLaneGroup, ApprovalInboxItem } from "@/lib/approvals/inbox/types";
import { ApprovalFastLanes } from "./approval-fast-lanes";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

function createApproval(
	id: string,
	requesterName: string,
	summary: string,
	riskLevel: ApprovalInboxItem["triage"]["riskLevel"] = "low",
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
			title: summary,
			subtitle: "May 2026",
			detail: summary,
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
			riskLevel,
			riskReasons: [riskLevel === "low" ? "no_conflicts_detected" : "needs_review"],
			fastLaneGroup: "low_risk_absence",
			isPayrollRelevant: false,
			explanation: riskLevel === "low" ? "No conflicts detected." : "Needs manager review.",
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

const groups: Array<{ key: ApprovalInboxFastLaneGroup; items: ApprovalInboxItem[] }> = [
	{
		key: "low_risk_absence",
		items: [
			createApproval("approval-1", "Ada Lovelace", "Vacation, May 18"),
			createApproval("approval-2", "Grace Hopper", "Remote work, May 19"),
		],
	},
	{
		key: "payroll_blocker",
		items: [createApproval("approval-3", "Katherine Johnson", "Payroll correction", "high")],
	},
];

describe("ApprovalFastLanes", () => {
	it("renders nothing when there are no groups", () => {
		const { container } = render(
			<ApprovalFastLanes
				groups={[]}
				isBusy={false}
				onBulkApprove={vi.fn()}
				onBulkReject={vi.fn()}
			/>,
		);

		expect(container.innerHTML).toBe("");
	});

	it("renders group labels, request counts, descriptions, and risk badges", () => {
		render(
			<ApprovalFastLanes
				groups={groups}
				isBusy={false}
				onBulkApprove={vi.fn()}
				onBulkReject={vi.fn()}
			/>,
		);

		expect(screen.getByRole("heading", { name: "Fast lanes" })).toBeTruthy();
		expect(screen.getByText("Review similar low-friction requests in batches.")).toBeTruthy();
		expect(screen.getByText("Low-risk absences")).toBeTruthy();
		expect(screen.getByText("2 requests")).toBeTruthy();
		expect(screen.getByText("Absences with no detected conflicts.")).toBeTruthy();
		expect(screen.getByText("No conflicts detected.")).toBeTruthy();
		expect(screen.getByText("Low risk")).toBeTruthy();
		expect(screen.getByText("Payroll blockers")).toBeTruthy();
		expect(screen.getByText("1 request")).toBeTruthy();
		expect(screen.getByText("Payroll-relevant requests that need priority review.")).toBeTruthy();
		expect(screen.getByText("High risk")).toBeTruthy();
	});

	it("expands item rows with requester names and summaries", () => {
		render(
			<ApprovalFastLanes
				groups={groups}
				isBusy={false}
				onBulkApprove={vi.fn()}
				onBulkReject={vi.fn()}
			/>,
		);

		expect(screen.queryByText("Ada Lovelace")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: /expand low-risk absences/i }));

		expect(screen.getByText("Ada Lovelace")).toBeTruthy();
		expect(screen.getByText("Vacation, May 18")).toBeTruthy();
		expect(screen.getByText("Grace Hopper")).toBeTruthy();
		expect(screen.getByText("Remote work, May 19")).toBeTruthy();
	});

	it("calls bulk approve with the group's approval ids", () => {
		const onBulkApprove = vi.fn();

		render(
			<ApprovalFastLanes
				groups={groups}
				isBusy={false}
				onBulkApprove={onBulkApprove}
				onBulkReject={vi.fn()}
			/>,
		);

		const groupCard = screen.getByText("Low-risk absences").closest("article");
		expect(groupCard).not.toBeNull();

		expect(
			within(groupCard!).getByRole("button", { name: /Approve low-risk absences/ }),
		).toBeTruthy();

		fireEvent.click(within(groupCard!).getByRole("button", { name: "Approve low-risk absences" }));

		expect(onBulkApprove).toHaveBeenCalledWith(["approval-1", "approval-2"]);
	});

	it("excludes items that cannot be bulk approved or approved from group approve", () => {
		const onBulkApprove = vi.fn();
		const mixedGroups = [
			{
				key: "low_risk_absence" as const,
				items: [
					createApproval("approval-1", "Ada Lovelace", "Vacation, May 18"),
					createApproval("approval-2", "Grace Hopper", "Remote work, May 19", "low", {
						canBulkApprove: false,
					}),
					createApproval("approval-3", "Katherine Johnson", "Training, May 20", "low", {
						canApprove: false,
					}),
				],
			},
		];

		render(
			<ApprovalFastLanes
				groups={mixedGroups}
				isBusy={false}
				onBulkApprove={onBulkApprove}
				onBulkReject={vi.fn()}
			/>,
		);

		const groupCard = screen.getByText("Low-risk absences").closest("article");
		expect(groupCard).not.toBeNull();
		expect(within(groupCard!).getByText("2 not eligible for bulk approve")).toBeTruthy();

		fireEvent.click(within(groupCard!).getByRole("button", { name: "Approve low-risk absences" }));

		expect(onBulkApprove).toHaveBeenCalledWith(["approval-1"]);
	});

	it("disables group approve when no items are eligible", () => {
		const onBulkApprove = vi.fn();
		const ineligibleGroups = [
			{
				key: "low_risk_absence" as const,
				items: [
					createApproval("approval-1", "Ada Lovelace", "Vacation, May 18", "low", {
						canBulkApprove: false,
					}),
					createApproval("approval-2", "Grace Hopper", "Remote work, May 19", "low", {
						canApprove: false,
					}),
				],
			},
		];

		render(
			<ApprovalFastLanes
				groups={ineligibleGroups}
				isBusy={false}
				onBulkApprove={onBulkApprove}
				onBulkReject={vi.fn()}
			/>,
		);

		const approveButton = screen.getByRole("button", { name: "Approve low-risk absences" });
		expect(approveButton).toHaveProperty("disabled", true);

		fireEvent.click(approveButton);

		expect(onBulkApprove).not.toHaveBeenCalled();
	});

	it("requires a trimmed reason before calling bulk reject", () => {
		const onBulkReject = vi.fn();

		render(
			<ApprovalFastLanes
				groups={groups}
				isBusy={false}
				onBulkApprove={vi.fn()}
				onBulkReject={onBulkReject}
			/>,
		);

		const groupCard = screen.getByText("Low-risk absences").closest("article");
		expect(groupCard).not.toBeNull();
		const card = within(groupCard!);

		fireEvent.click(card.getByRole("button", { name: "Reject low-risk absences" }));

		const confirmButton = card.getByRole("button", { name: "Confirm reject low-risk absences" });
		expect(card.getByLabelText("Bulk reject reason")).toBeTruthy();
		expect(confirmButton).toHaveProperty("disabled", true);

		fireEvent.change(card.getByLabelText("Bulk reject reason"), {
			target: { value: "   " },
		});
		expect(confirmButton).toHaveProperty("disabled", true);

		fireEvent.change(card.getByLabelText("Bulk reject reason"), {
			target: { value: "Needs documentation " },
		});
		expect(confirmButton).toHaveProperty("disabled", false);

		fireEvent.click(confirmButton);

		expect(onBulkReject).toHaveBeenCalledWith(["approval-1", "approval-2"], "Needs documentation");
	});

	it("excludes items that cannot be rejected from group reject", () => {
		const onBulkReject = vi.fn();
		const mixedGroups = [
			{
				key: "low_risk_absence" as const,
				items: [
					createApproval("approval-1", "Ada Lovelace", "Vacation, May 18"),
					createApproval("approval-2", "Grace Hopper", "Remote work, May 19", "low", {
						canReject: false,
					}),
				],
			},
		];

		render(
			<ApprovalFastLanes
				groups={mixedGroups}
				isBusy={false}
				onBulkApprove={vi.fn()}
				onBulkReject={onBulkReject}
			/>,
		);

		const groupCard = screen.getByText("Low-risk absences").closest("article");
		expect(groupCard).not.toBeNull();
		const card = within(groupCard!);
		expect(card.getByText("1 not eligible for bulk reject")).toBeTruthy();

		fireEvent.click(card.getByRole("button", { name: "Reject low-risk absences" }));
		fireEvent.change(card.getByLabelText("Bulk reject reason"), {
			target: { value: "Needs documentation" },
		});
		fireEvent.click(card.getByRole("button", { name: "Confirm reject low-risk absences" }));

		expect(onBulkReject).toHaveBeenCalledWith(["approval-1"], "Needs documentation");
	});

	it("disables group reject when no items are eligible", () => {
		const onBulkReject = vi.fn();
		const ineligibleGroups = [
			{
				key: "low_risk_absence" as const,
				items: [
					createApproval("approval-1", "Ada Lovelace", "Vacation, May 18", "low", {
						canReject: false,
					}),
				],
			},
		];

		render(
			<ApprovalFastLanes
				groups={ineligibleGroups}
				isBusy={false}
				onBulkApprove={vi.fn()}
				onBulkReject={onBulkReject}
			/>,
		);

		const rejectButton = screen.getByRole("button", { name: "Reject low-risk absences" });
		expect(rejectButton).toHaveProperty("disabled", true);

		fireEvent.click(rejectButton);

		expect(screen.queryByLabelText("Bulk reject reason")).toBeNull();
		expect(onBulkReject).not.toHaveBeenCalled();
	});
});

// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApprovalFastLaneGroup, TriagedApprovalItem } from "@/lib/approvals/triage";
import { ApprovalFastLanes } from "./approval-fast-lanes";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

function createApproval(
	id: string,
	requesterName: string,
	summary: string,
	riskLevel: TriagedApprovalItem["triage"]["riskLevel"] = "low",
): TriagedApprovalItem {
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
			title: summary,
			subtitle: "May 2026",
			summary,
		},
		triage: {
			riskLevel,
			riskReasons: [riskLevel === "low" ? "no_conflicts_detected" : "needs_review"],
			fastLaneGroup: "low_risk_absence",
			isPayrollRelevant: false,
			ageDays: 1,
		},
	};
}

const groups: ApprovalFastLaneGroup[] = [
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

		fireEvent.click(within(groupCard!).getByRole("button", { name: "Approve Low-risk absences" }));

		expect(onBulkApprove).toHaveBeenCalledWith(["approval-1", "approval-2"]);
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

		fireEvent.click(card.getByRole("button", { name: "Reject Low-risk absences" }));

		const confirmButton = card.getByRole("button", { name: "Confirm reject Low-risk absences" });
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
});

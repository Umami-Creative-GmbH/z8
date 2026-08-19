// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ApprovalInboxDetailSection,
	ApprovalInboxItem,
} from "@/lib/approvals/inbox/types";
import { ApprovalDetailPanel } from "./approval-detail-panel";
import { normalizeTravelExpenseDetailEntity } from "./approval-detail-utils";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (key: string, fallback: string, params?: Record<string, string>) =>
			key === "approvals:approvals.timelineActor"
				? `${params?.at} durch ${params?.actorName}`
				: key === "approvals:approvals.requestedCorrection"
					? "Beantragte Korrektur"
					: key === "approvals:approvals.workCategory"
						? "Arbeitskategorie"
						: key === "approvals:approvals.original"
							? "Ursprünglich"
							: key === "approvals:approvals.requested"
								? "Angefordert"
								: key === "timeTracking.noCategory"
									? "Keine Kategorie (100 %)"
									: key === "approvals:approvals.workCategoryUnavailable"
										? "Kategorie nicht verfügbar"
				: fallback,
	}),
}));

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/ui/button", () => ({
	Button: ({ disabled, children, ...props }: React.ComponentProps<"button">) => (
		<button
			{...props}
			type={props.type ?? "button"}
			aria-disabled={disabled ? "true" : "false"}
			data-disabled={disabled ? "true" : "false"}
		>
			{children}
		</button>
	),
}));

const mockState = vi.hoisted(() => ({
	actions: {
		canApprove: true,
		canReject: true,
		canBulkApprove: true,
		requiresRejectReason: true,
	},
	approveIsPending: false,
	rejectIsPending: false,
	approveMutateAsync: vi.fn(),
	rejectMutateAsync: vi.fn(),
	sections: [] as ApprovalInboxDetailSection[],
}));

vi.mock("@/lib/query/use-approval-inbox", () => ({
	useApprovalDetail: () => ({
		data: {
			item: approvalItem,
			sections: mockState.sections,
			actions: mockState.actions,
		},
	}),
	useApproveApproval: () => ({
		isPending: mockState.approveIsPending,
		mutateAsync: mockState.approveMutateAsync,
	}),
	useRejectApproval: () => ({
		isPending: mockState.rejectIsPending,
		mutateAsync: mockState.rejectMutateAsync,
	}),
}));

vi.mock("@/lib/query", () => ({
	useEmployeeClockStatuses: () => ({ getStatus: () => null }),
}));

const approvalItem: ApprovalInboxItem = {
	id: "approval-1",
	type: "absence_entry",
	entityId: "absence-1",
	status: "pending",
	requester: {
		id: "employee-1",
		name: "Ada Lovelace",
		email: "ada@example.com",
		image: null,
		teamId: null,
	},
	summary: {
		title: "Absence Request",
		subtitle: "May 18, 2026",
		detail: "Sick Leave, May 18, 2026",
		badge: { label: "Sick Leave", color: null },
	},
	timing: {
		createdAt: "2026-05-01T00:00:00.000Z",
		resolvedAt: null,
		slaDeadline: null,
		ageDays: 1,
	},
	triage: {
		priority: "normal",
		riskLevel: "low",
		riskReasons: ["no_conflicts_detected"],
		fastLaneGroup: "low_risk_absence",
		isPayrollRelevant: false,
		explanation: "No conflicts detected.",
	},
	capabilities: {
		canApprove: true,
		canReject: true,
		canBulkApprove: true,
		requiresRejectReason: true,
	},
};

function expectButtonDisabled(button: HTMLElement) {
	expect(button.getAttribute("data-disabled")).toBe("true");
}

describe("normalizeTravelExpenseDetailEntity", () => {
	it("converts serialized trip dates into Date objects", () => {
		const normalized = normalizeTravelExpenseDetailEntity({
			tripStart: "2026-04-15T00:00:00.000Z",
			tripEnd: "2026-04-17T00:00:00.000Z",
			destinationCity: "Berlin",
			calculatedCurrency: "EUR",
			calculatedAmount: "120.50",
			notes: "Client visit",
		});

		expect(normalized.tripStart).toBeInstanceOf(Date);
		expect(normalized.tripEnd).toBeInstanceOf(Date);
		expect(normalized.tripStart.toISOString()).toBe("2026-04-15T00:00:00.000Z");
		expect(normalized.tripEnd.toISOString()).toBe("2026-04-17T00:00:00.000Z");
	});
});

describe("ApprovalDetailPanel", () => {
	beforeEach(() => {
		mockState.actions = { ...approvalItem.capabilities };
		mockState.approveIsPending = false;
		mockState.rejectIsPending = false;
		mockState.approveMutateAsync.mockReset();
		mockState.rejectMutateAsync.mockReset();
		mockState.approveMutateAsync.mockResolvedValue({ success: true });
		mockState.rejectMutateAsync.mockResolvedValue({ success: true });
		mockState.sections = [
			{
				type: "key_value",
				title: "Request",
				rows: [{ label: "Type", value: "Absence Request" }],
			},
			{ type: "callout", title: "Risk", body: "No conflicts detected.", tone: "info" },
			{
				type: "timeline",
				title: "Timeline",
				events: [
					{
						id: "event-1",
						label: "Request created",
						at: "May 1, 2026",
						actorName: "Ada Lovelace",
					},
				],
			},
		];
	});

	it("shows generic approval detail sections", async () => {
		render(
			<ApprovalDetailPanel
				approval={approvalItem}
				open={true}
				onOpenChange={vi.fn()}
				onActioned={vi.fn()}
			/>,
		);

		expect(await screen.findByText("Request")).toBeTruthy();
		expect(screen.getByText("Absence Request")).toBeTruthy();
		expect(screen.getByText("No conflicts detected.")).toBeTruthy();
	});

	it("translates the timeline actor connector", async () => {
		render(
			<ApprovalDetailPanel
				approval={approvalItem}
				open={true}
				onOpenChange={vi.fn()}
				onActioned={vi.fn()}
			/>,
		);

		expect(await screen.findByText("May 1, 2026 durch Ada Lovelace")).toBeTruthy();
	});

	it("translates semantic correction values and exposes original/requested descriptions", async () => {
		mockState.sections = [
			{
				type: "key_value",
				title: {
					key: "approvals:approvals.requestedCorrection",
					fallback: "Requested Correction",
				},
				rows: [
					{
						label: {
							key: "approvals:approvals.workCategory",
							fallback: "Work category",
						},
						value: {
							kind: "change",
							original: {
								kind: "work_category",
								value: { state: "unavailable", id: "category-deleted" },
							},
							requested: {
								kind: "work_category",
								value: { state: "none" },
							},
						},
					},
				],
			},
		];

		render(
			<ApprovalDetailPanel
				approval={approvalItem}
				open={true}
				onOpenChange={vi.fn()}
				onActioned={vi.fn()}
			/>,
		);

		expect(await screen.findByText("Beantragte Korrektur")).toBeTruthy();
		expect(screen.getByText("Arbeitskategorie")).toBeTruthy();
		expect(screen.getByText(/Ursprünglich/)).toBeTruthy();
		expect(screen.getByText("Kategorie nicht verfügbar")).toBeTruthy();
		expect(screen.getByText(/Angefordert/)).toBeTruthy();
		expect(screen.getByText("Keine Kategorie (100 %)")).toBeTruthy();
	});

	it("keeps the header badge clear of the close button and pads the detail content", async () => {
		render(
			<ApprovalDetailPanel
				approval={approvalItem}
				open={true}
				onOpenChange={vi.fn()}
				onActioned={vi.fn()}
			/>,
		);

		const dialog = await screen.findByRole("dialog");
		const header = dialog.querySelector('[data-slot="sheet-header"]');
		const body = dialog.querySelector('[data-slot="approval-detail-body"]');
		const footer = dialog.querySelector('[data-slot="sheet-footer"]');
		const badge = screen.getByText("Sick Leave");

		expect(header?.className).toContain("pr-12");
		expect(header?.className).toContain("px-5");
		expect(body?.className).toContain("px-5");
		expect(footer?.className).toContain("px-5");
		expect(badge.className).toContain("max-w-");
		expect(badge.className).toContain("truncate");
	});

	it("approves with the approval id when approval is allowed", async () => {
		render(
			<ApprovalDetailPanel
				approval={approvalItem}
				open={true}
				onOpenChange={vi.fn()}
				onActioned={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /Approve/ }));

		await waitFor(() => {
			expect(mockState.approveMutateAsync).toHaveBeenCalledWith("approval-1");
		});
	});

	it("requires a nonblank rejection reason and rejects with the approval id and reason", async () => {
		render(
			<ApprovalDetailPanel
				approval={approvalItem}
				open={true}
				onOpenChange={vi.fn()}
				onActioned={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /Reject/ }));
		const confirmButton = screen.getByRole("button", { name: /Confirm Rejection/ });
		expectButtonDisabled(confirmButton);

		fireEvent.change(screen.getByLabelText("Reason for rejection"), {
			target: { value: "   " },
		});
		expectButtonDisabled(confirmButton);

		fireEvent.change(screen.getByLabelText("Reason for rejection"), {
			target: { value: " Needs correction " },
		});
		fireEvent.click(confirmButton);

		await waitFor(() => {
			expect(mockState.rejectMutateAsync).toHaveBeenCalledWith({
				approvalId: "approval-1",
				reason: "Needs correction",
			});
		});
	});

	it("does not approve when approval is disabled", () => {
		mockState.actions = { ...approvalItem.capabilities, canApprove: false };
		render(
			<ApprovalDetailPanel
				approval={approvalItem}
				open={true}
				onOpenChange={vi.fn()}
				onActioned={vi.fn()}
			/>,
		);

		const approveButton = screen.getByRole("button", { name: /Approve/ });
		expectButtonDisabled(approveButton);
		fireEvent.click(approveButton);

		expect(mockState.approveMutateAsync).not.toHaveBeenCalled();
	});

	it("does not approve while any approval action is pending", () => {
		const { rerender } = render(
			<ApprovalDetailPanel
				approval={approvalItem}
				open={true}
				onOpenChange={vi.fn()}
				onActioned={vi.fn()}
			/>,
		);

		mockState.rejectIsPending = true;
		rerender(
			<ApprovalDetailPanel
				approval={approvalItem}
				open={true}
				onOpenChange={vi.fn()}
				onActioned={vi.fn()}
			/>,
		);

		const approveButton = screen.getByRole("button", { name: /Approve/ });
		expectButtonDisabled(approveButton);
		fireEvent.click(approveButton);

		expect(mockState.approveMutateAsync).not.toHaveBeenCalled();
	});

	it("does not reject when rejection is disabled", () => {
		const { rerender } = render(
			<ApprovalDetailPanel
				approval={approvalItem}
				open={true}
				onOpenChange={vi.fn()}
				onActioned={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /Reject/ }));
		fireEvent.change(screen.getByLabelText("Reason for rejection"), {
			target: { value: "Not enough coverage" },
		});

		mockState.actions = { ...approvalItem.capabilities, canReject: false };
		rerender(
			<ApprovalDetailPanel
				approval={approvalItem}
				open={true}
				onOpenChange={vi.fn()}
				onActioned={vi.fn()}
			/>,
		);

		const confirmButton = screen.getByRole("button", { name: /Confirm Rejection/ });
		expectButtonDisabled(confirmButton);
		fireEvent.click(confirmButton);

		expect(mockState.rejectMutateAsync).not.toHaveBeenCalled();
	});

	it("does not reject while any approval action is pending", () => {
		const { rerender } = render(
			<ApprovalDetailPanel
				approval={approvalItem}
				open={true}
				onOpenChange={vi.fn()}
				onActioned={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /Reject/ }));

		fireEvent.change(screen.getByLabelText("Reason for rejection"), {
			target: { value: "Needs manager review" },
		});

		mockState.approveIsPending = true;
		rerender(
			<ApprovalDetailPanel
				approval={approvalItem}
				open={true}
				onOpenChange={vi.fn()}
				onActioned={vi.fn()}
			/>,
		);

		const confirmButton = screen.getByRole("button", { name: /Confirm Rejection/ });
		expectButtonDisabled(confirmButton);
		fireEvent.click(confirmButton);

		expect(mockState.rejectMutateAsync).not.toHaveBeenCalled();
	});
});

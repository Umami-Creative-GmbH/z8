// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalInboxDetailSection, ApprovalInboxItem } from "@/lib/approvals/inbox/types";
import { ApprovalDetailPanel } from "./approval-detail-panel";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string>) =>
			fallback.replace(/\{(\w+)\}/g, (_match, name: string) => params?.[name] ?? ""),
	}),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/navigation", () => ({
	Link: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

const mockState = vi.hoisted(() => ({
	canApprove: true,
	approveMutateAsync: vi.fn(),
	sections: [] as ApprovalInboxDetailSection[],
}));

vi.mock("@/lib/query/use-approval-inbox", () => ({
	useApprovalDetail: () => ({
		data: {
			item: approvalItem,
			sections: mockState.sections,
			actions: {
				canApprove: mockState.canApprove,
				canReject: true,
				canBulkApprove: false,
				requiresRejectReason: true,
			},
		},
	}),
	useApproveApproval: () => ({ isPending: false, mutateAsync: mockState.approveMutateAsync }),
	useRejectApproval: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

vi.mock("@/lib/query", () => ({
	useEmployeeClockStatuses: () => ({ getStatus: () => null }),
}));

const approvalItem: ApprovalInboxItem = {
	id: "approval-1",
	type: "travel_expense_report",
	entityId: "report-1",
	status: "pending",
	requester: {
		id: "employee-1",
		name: "Ada Lovelace",
		email: "ada@example.com",
		image: null,
		teamId: null,
	},
	summary: { title: "Expense report", subtitle: "Dinner", detail: "1 expense", badge: null },
	timing: {
		createdAt: "2026-09-17T08:00:00.000Z",
		resolvedAt: null,
		slaDeadline: null,
		ageDays: 1,
	},
	triage: {
		priority: "normal",
		riskLevel: "low",
		riskReasons: [],
		fastLaneGroup: null,
		isPayrollRelevant: false,
		explanation: "",
	},
	capabilities: {
		canApprove: true,
		canReject: true,
		canBulkApprove: false,
		requiresRejectReason: true,
	},
} as unknown as ApprovalInboxItem;

const acceptance: ApprovalInboxDetailSection = {
	type: "receipt_exception_acceptance",
	title: {
		key: "approvals:approvals.evidence.receiptExceptionsTitle",
		fallback: "Missing receipts",
	},
	items: [
		{ itemId: "item-a", label: "1. Customer dinner", reason: "Printer broken" },
		{ itemId: "item-b", label: "2. Taxi", reason: "Driver had no receipts" },
	],
};

function mount() {
	render(
		<ApprovalDetailPanel
			approval={approvalItem}
			open
			onOpenChange={vi.fn()}
			onActioned={vi.fn()}
		/>,
	);
}

describe("missing-receipt exception acceptance in the approval panel (#604)", () => {
	beforeEach(() => {
		mockState.canApprove = true;
		mockState.sections = [acceptance];
		mockState.approveMutateAsync.mockReset();
		mockState.approveMutateAsync.mockResolvedValue({ success: true });
	});

	it("approves only after every exception is explicitly accepted, sending the accepted expenses", async () => {
		mount();
		const approve = screen.getByRole("button", { name: /approve/i });
		expect((approve as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByText(/Printer broken/)).toBeTruthy();

		fireEvent.click(screen.getByRole("checkbox", { name: /1\. Customer dinner/ }));
		expect((approve as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(screen.getByRole("checkbox", { name: /2\. Taxi/ }));
		expect((approve as HTMLButtonElement).disabled).toBe(false);

		fireEvent.click(approve);
		await waitFor(() =>
			expect(mockState.approveMutateAsync).toHaveBeenCalledWith({
				approvalId: "approval-1",
				acceptedReceiptExceptionItemIds: ["item-a", "item-b"],
			}),
		);
	});

	it("approves a report without exceptions as before", async () => {
		mockState.sections = [];
		mount();
		fireEvent.click(screen.getByRole("button", { name: /approve/i }));
		await waitFor(() => expect(mockState.approveMutateAsync).toHaveBeenCalledWith("approval-1"));
	});

	it("lists the exceptions without checkboxes when no decision can be made", () => {
		mockState.canApprove = false;
		mount();
		expect(screen.queryByRole("checkbox")).toBeNull();
		expect(screen.getByText(/Driver had no receipts/)).toBeTruthy();
	});
});

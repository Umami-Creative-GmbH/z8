/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UnifiedApprovalItem } from "@/lib/approvals/domain/types";

const {
	approvalInboxMock,
	bulkApproveMutateAsyncMock,
	bulkRejectMutateAsyncMock,
	refetchMock,
	toastErrorMock,
	toastSuccessMock,
} = vi.hoisted(() => ({
	approvalInboxMock: vi.fn(),
	bulkApproveMutateAsyncMock: vi.fn(),
	bulkRejectMutateAsyncMock: vi.fn(),
	refetchMock: vi.fn(),
	toastErrorMock: vi.fn(),
	toastSuccessMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));

vi.mock("sonner", () => ({
	toast: {
		error: toastErrorMock,
		success: toastSuccessMock,
	},
}));

vi.mock("./components/approval-inbox-toolbar", () => ({
	ApprovalInboxToolbar: ({ onSelectAll }: { onSelectAll: (checked: boolean) => void }) => (
		<button type="button" onClick={() => onSelectAll(true)}>
			Select All
		</button>
	),
}));

vi.mock("./components/approval-inbox-table", () => ({
	ApprovalInboxTable: () => <div>table</div>,
}));

vi.mock("./components/approval-detail-panel", () => ({
	ApprovalDetailPanel: () => null,
}));

vi.mock("@/components/ui/button", () => ({
	Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
		<button {...props}>{children}</button>
	),
}));

vi.mock("@/components/ui/card", () => ({
	Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	CardDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	CardTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/dialog", () => ({
	Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
		open ? <div>{children}</div> : null,
	DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/skeleton", () => ({
	Skeleton: () => <div>loading</div>,
}));

vi.mock("@/components/ui/textarea", () => ({
	Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}));

vi.mock("@/lib/query/use-approval-inbox", () => ({
	useApprovalInbox: approvalInboxMock,
	useBulkApprove: vi.fn(() => ({
		isPending: false,
		mutateAsync: bulkApproveMutateAsyncMock,
	})),
	useBulkReject: vi.fn(() => ({
		isPending: false,
		mutateAsync: bulkRejectMutateAsyncMock,
	})),
}));

import ApprovalInboxPage from "./page";

describe("ApprovalInboxPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		approvalInboxMock.mockReturnValue({
			data: {
				pages: [
					{
						items: [
							{
								id: "approval-1",
								approvalType: "travel_expense_claim",
							} satisfies Partial<UnifiedApprovalItem>,
						] as UnifiedApprovalItem[],
						total: 1,
					},
				],
			},
			isLoading: false,
			isError: false,
			error: null,
			isFetching: false,
			fetchNextPage: vi.fn(),
			hasNextPage: false,
			isFetchingNextPage: false,
			refetch: refetchMock,
		});
		bulkApproveMutateAsyncMock.mockResolvedValue({ succeeded: [], failed: [] });
		bulkRejectMutateAsyncMock.mockResolvedValue({
			succeeded: [],
			failed: [],
		});
	});

	it("renders an explicit inbox error state when the inbox query fails", () => {
		approvalInboxMock.mockReturnValue({
			data: undefined,
			isLoading: false,
			isError: true,
			error: new Error("Employee not found"),
			isFetching: false,
			fetchNextPage: vi.fn(),
			hasNextPage: false,
			isFetchingNextPage: false,
			refetch: refetchMock,
		});

		render(<ApprovalInboxPage />);

		expect(screen.getByText("Unable to load approval inbox")).toBeTruthy();
		expect(screen.getByText("Employee not found")).toBeTruthy();
		expect(screen.queryByText("No pending requests")).toBeNull();
	});

	it("shows a toast when bulk approve throws instead of leaving an uncaught rejection", async () => {
		bulkApproveMutateAsyncMock.mockRejectedValue(new Error("Bulk approve failed"));

		render(<ApprovalInboxPage />);

		fireEvent.click(screen.getByRole("button", { name: "Select All" }));
		fireEvent.click(screen.getByRole("button", { name: /Approve Selected/ }));

		await waitFor(() => {
			expect(toastErrorMock).toHaveBeenCalledWith("Bulk approve failed");
		});
		expect(refetchMock).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: /Approve Selected/ })).toBeTruthy();
	});

	it("handles bulk reject partial success through the page dialog flow", async () => {
		bulkRejectMutateAsyncMock.mockResolvedValue({
			succeeded: [{ id: "approval-1", approvalType: "travel_expense_claim", status: "rejected" }],
			failed: [{ id: "approval-2", code: "stale", message: "Already handled" }],
		});

		render(<ApprovalInboxPage />);

		fireEvent.click(screen.getByRole("button", { name: "Select All" }));
		fireEvent.click(screen.getByRole("button", { name: /Reject Selected/ }));
		fireEvent.change(screen.getByLabelText("Reason for rejection"), {
			target: { value: "Missing receipt" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Confirm Rejection" }));

		await waitFor(() => {
			expect(bulkRejectMutateAsyncMock).toHaveBeenCalledWith({
				approvalIds: ["approval-1"],
				reason: "Missing receipt",
			});
			expect(toastSuccessMock).toHaveBeenCalledWith("1 request(s) rejected");
			expect(toastErrorMock).toHaveBeenCalledWith("1 request(s) failed\nAlready handled");
		});
		expect(refetchMock).toHaveBeenCalled();
	});
});

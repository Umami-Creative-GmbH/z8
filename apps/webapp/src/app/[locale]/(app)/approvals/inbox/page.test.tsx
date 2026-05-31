/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ApprovalInboxItem,
	ApprovalInboxListResult,
	ApprovalInboxType,
} from "@/lib/approvals/inbox/types";

const {
	approvalInboxMock,
	bulkApproveMutateAsyncMock,
	bulkRejectMutateAsyncMock,
	approveMutateAsyncMock,
	rejectMutateAsyncMock,
	refetchMock,
	toastErrorMock,
	toastSuccessMock,
} = vi.hoisted(() => ({
	approvalInboxMock: vi.fn(),
	bulkApproveMutateAsyncMock: vi.fn(),
	bulkRejectMutateAsyncMock: vi.fn(),
	approveMutateAsyncMock: vi.fn(),
	rejectMutateAsyncMock: vi.fn(),
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
	ApprovalInboxToolbar: ({
		filters,
		onFiltersChange,
		onSelectAll,
		supportedTypes,
		totalCount,
	}: {
		filters: { status?: string; search?: string };
		onFiltersChange: (filters: { status?: string; search?: string }) => void;
		onSelectAll: (checked: boolean) => void;
		supportedTypes: ApprovalInboxType[];
		totalCount: number;
	}) => (
		<div>
			<span>{totalCount} pending</span>
			<button type="button" onClick={() => onSelectAll(true)}>
				Select All
			</button>
			<button type="button" onClick={() => onFiltersChange({ ...filters, search: "avery" })}>
				Search Avery
			</button>
			{supportedTypes.map((type) => (
				<span key={type}>
					{
						{
							absence_entry: "Absence Requests",
							time_entry: "Time Corrections",
							travel_expense_claim: "Travel Expenses",
						}[type]
					}
				</span>
			))}
		</div>
	),
}));

vi.mock("./components/approval-inbox-table", () => ({
	ApprovalInboxTable: ({ items }: { items: ApprovalInboxItem[] }) => (
		<div>
			{items.length === 0
				? "No pending requests"
				: items.map((item) => (
						<div key={item.id}>
							<span>{item.requester.name}</span>
							<span>{item.triage.explanation}</span>
						</div>
					))}
		</div>
	),
}));

vi.mock("./components/approval-detail-panel", () => ({
	ApprovalDetailPanel: () => null,
}));

vi.mock("./components/approval-fast-lanes", () => ({
	ApprovalFastLanes: ({
		groups,
		onBulkApprove,
	}: {
		groups: Array<{ key: string; items: ApprovalInboxItem[] }>;
		onBulkApprove: (approvalIds: string[]) => void;
	}) => (
		<div>
			{groups.map((group) => (
				<button
					key={group.key}
					type="button"
					onClick={() => onBulkApprove(group.items.map((item) => item.id))}
				>
					Approve Low-risk absences
				</button>
			))}
		</div>
	),
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
	useApproveApproval: vi.fn(() => ({
		isPending: false,
		mutateAsync: approveMutateAsyncMock,
	})),
	useRejectApproval: vi.fn(() => ({
		isPending: false,
		mutateAsync: rejectMutateAsyncMock,
	})),
}));

import ApprovalInboxPage from "./page";

function makeApprovalInboxItem(overrides: Partial<ApprovalInboxItem> = {}): ApprovalInboxItem {
	return {
		id: "approval-1",
		type: "absence_entry",
		entityId: "absence-1",
		status: "pending",
		requester: {
			id: "employee-1",
			name: "Avery Employee",
			email: "avery@example.com",
			image: null,
			teamId: "team-1",
		},
		summary: {
			title: "Vacation request",
			subtitle: "Jun 3-4",
			detail: "2 days away",
			badge: null,
		},
		timing: {
			createdAt: "2026-05-30T08:00:00.000Z",
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
		...overrides,
	};
}

function makeApprovalInboxPage(
	items: ApprovalInboxItem[] = [makeApprovalInboxItem()],
	overrides: Partial<ApprovalInboxListResult> = {},
): ApprovalInboxListResult {
	return {
		items,
		total: items.length,
		counts: {
			absence_entry: items.filter((item) => item.type === "absence_entry").length,
			time_entry: items.filter((item) => item.type === "time_entry").length,
			travel_expense_claim: items.filter((item) => item.type === "travel_expense_claim").length,
		},
		supportedTypes: ["absence_entry", "time_entry", "travel_expense_claim"],
		warnings: [],
		hasMore: false,
		nextCursor: null,
		...overrides,
	};
}

describe("ApprovalInboxPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		approvalInboxMock.mockReturnValue({
			data: {
				pages: [makeApprovalInboxPage()],
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
		approveMutateAsyncMock.mockResolvedValue({ success: true });
		rejectMutateAsyncMock.mockResolvedValue({ success: true });
	});

	it("renders new inbox contract content and supported type filters", () => {
		render(<ApprovalInboxPage />);

		expect(screen.getByText("Approval Inbox")).toBeTruthy();
		expect(screen.getByText("Avery Employee")).toBeTruthy();
		expect(screen.getByText("No conflicts detected.")).toBeTruthy();
		expect(screen.queryByText("Shift Requests")).toBeNull();
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

	it("uses the shared app page spacing shell", () => {
		const { container } = render(<ApprovalInboxPage />);

		expect(container.firstElementChild?.className).toContain(
			"@container/main flex flex-1 flex-col gap-6 py-4 md:py-6",
		);
		expect(container.querySelectorAll(":scope > div > .px-4.lg\\:px-6")).toHaveLength(2);
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
			succeeded: [{ id: "approval-1", type: "travel_expense_claim", status: "rejected" }],
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

	it("bulk approve selected approvals only sends selected items eligible for bulk approval", async () => {
		approvalInboxMock.mockReturnValue({
			data: {
				pages: [
					makeApprovalInboxPage([
						makeApprovalInboxItem({ id: "approval-1" }),
						makeApprovalInboxItem({
							id: "approval-2",
							requester: {
								id: "employee-2",
								name: "Morgan Manager",
								email: "morgan@example.com",
								image: null,
								teamId: "team-1",
							},
							capabilities: {
								canApprove: true,
								canReject: true,
								canBulkApprove: false,
								requiresRejectReason: true,
							},
						}),
						makeApprovalInboxItem({
							id: "approval-3",
							requester: {
								id: "employee-3",
								name: "Riley Reviewer",
								email: "riley@example.com",
								image: null,
								teamId: "team-1",
							},
							capabilities: {
								canApprove: false,
								canReject: true,
								canBulkApprove: true,
								requiresRejectReason: true,
							},
						}),
					]),
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

		render(<ApprovalInboxPage />);

		fireEvent.click(screen.getByRole("button", { name: "Select All" }));
		fireEvent.click(screen.getByRole("button", { name: /Approve Selected/ }));

		await waitFor(() => {
			expect(bulkApproveMutateAsyncMock).toHaveBeenCalledWith(["approval-1"]);
		});
	});

	it("bulk approve selected approvals ignores duplicate rapid submissions while in flight", async () => {
		let resolveApproval: (value: { succeeded: []; failed: [] }) => void = () => undefined;
		bulkApproveMutateAsyncMock.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveApproval = resolve;
				}),
		);

		render(<ApprovalInboxPage />);

		fireEvent.click(screen.getByRole("button", { name: "Select All" }));
		const approveButton = screen.getByRole("button", { name: /Approve Selected/ });
		fireEvent.click(approveButton);
		fireEvent.click(approveButton);

		expect(bulkApproveMutateAsyncMock).toHaveBeenCalledTimes(1);

		resolveApproval({ succeeded: [], failed: [] });

		await waitFor(() => expect(refetchMock).toHaveBeenCalled());
	});

	it("bulk approve selected approvals no-ops when no selected items are eligible", () => {
		approvalInboxMock.mockReturnValue({
			data: {
				pages: [
					makeApprovalInboxPage([
						makeApprovalInboxItem({
							capabilities: {
								canApprove: false,
								canReject: true,
								canBulkApprove: true,
								requiresRejectReason: true,
							},
						}),
					]),
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

		render(<ApprovalInboxPage />);

		fireEvent.click(screen.getByRole("button", { name: "Select All" }));
		const approveButton = screen.getByRole("button", { name: /Approve Selected/ });
		expect(approveButton).toHaveProperty("disabled", true);

		fireEvent.click(approveButton);

		expect(bulkApproveMutateAsyncMock).not.toHaveBeenCalled();
	});

	it("bulk reject selected approvals only sends selected items eligible for rejection", async () => {
		approvalInboxMock.mockReturnValue({
			data: {
				pages: [
					makeApprovalInboxPage([
						makeApprovalInboxItem({ id: "approval-1" }),
						makeApprovalInboxItem({
							id: "approval-2",
							requester: {
								id: "employee-2",
								name: "Morgan Manager",
								email: "morgan@example.com",
								image: null,
								teamId: "team-1",
							},
							capabilities: {
								canApprove: true,
								canReject: false,
								canBulkApprove: true,
								requiresRejectReason: true,
							},
						}),
					]),
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
		});
	});

	it("bulk reject selected approvals no-ops when no selected items are eligible", () => {
		approvalInboxMock.mockReturnValue({
			data: {
				pages: [
					makeApprovalInboxPage([
						makeApprovalInboxItem({
							capabilities: {
								canApprove: true,
								canReject: false,
								canBulkApprove: true,
								requiresRejectReason: true,
							},
						}),
					]),
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

		render(<ApprovalInboxPage />);

		fireEvent.click(screen.getByRole("button", { name: "Select All" }));
		const rejectButton = screen.getByRole("button", { name: /Reject Selected/ });
		expect(rejectButton).toHaveProperty("disabled", true);

		fireEvent.click(rejectButton);

		expect(screen.queryByLabelText("Reason for rejection")).toBeNull();
		expect(bulkRejectMutateAsyncMock).not.toHaveBeenCalled();
	});

	it("clears the full selection after a fast-lane approval succeeds", async () => {
		bulkApproveMutateAsyncMock.mockResolvedValue({
			succeeded: [{ id: "approval-1", type: "absence_entry", status: "approved" }],
			failed: [],
		});
		approvalInboxMock.mockReturnValue({
			data: {
				pages: [
					makeApprovalInboxPage([
						makeApprovalInboxItem(),
						makeApprovalInboxItem({
							id: "approval-2",
							type: "travel_expense_claim",
							entityId: "travel-1",
							requester: {
								id: "employee-2",
								name: "Morgan Manager",
								email: "morgan@example.com",
								image: null,
								teamId: "team-1",
							},
							summary: {
								title: "Travel expense",
								subtitle: "Receipt review",
								detail: "Client travel reimbursement",
								badge: null,
							},
							triage: {
								priority: "normal",
								riskLevel: "medium",
								riskReasons: ["needs_review"],
								fastLaneGroup: null,
								isPayrollRelevant: false,
								explanation: "Receipt requires review.",
							},
						}),
					]),
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

		render(<ApprovalInboxPage />);

		fireEvent.click(screen.getByRole("button", { name: "Select All" }));
		expect(screen.getByRole("button", { name: /Approve Selected/ })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Approve Low-risk absences" }));

		await waitFor(() => {
			expect(bulkApproveMutateAsyncMock).toHaveBeenCalledWith(["approval-1"]);
			expect(screen.queryByRole("button", { name: /Approve Selected/ })).toBeNull();
		});
	});

	it("does not render a second empty state below the table", () => {
		approvalInboxMock.mockReturnValue({
			data: {
				pages: [makeApprovalInboxPage([])],
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

		render(<ApprovalInboxPage />);

		expect(screen.getAllByText("No pending requests")).toHaveLength(1);
	});

	it("clears selected approvals when filters change before bulk actions run", () => {
		render(<ApprovalInboxPage />);

		fireEvent.click(screen.getByRole("button", { name: "Select All" }));
		expect(screen.getByRole("button", { name: /Approve Selected/ })).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Search Avery" }));

		expect(screen.queryByRole("button", { name: /Approve Selected/ })).toBeNull();
		expect(bulkApproveMutateAsyncMock).not.toHaveBeenCalled();
	});

	it("renders duplicate inbox warnings once", () => {
		approvalInboxMock.mockReturnValue({
			data: {
				pages: [
					makeApprovalInboxPage(undefined, {
						warnings: [
							{ source: "Import warning", message: "Some approvals could not be loaded." },
							{ source: "Import warning", message: "Some approvals could not be loaded." },
						],
					}),
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

		render(<ApprovalInboxPage />);

		expect(screen.getAllByText("Import warning")).toHaveLength(1);
		expect(screen.getAllByText("Some approvals could not be loaded.")).toHaveLength(1);
	});
});

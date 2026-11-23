/* @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Activity } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BriefingApprovalActionItem } from "@/lib/manager-daily-briefing/types";
import { TodayApprovalsPanel } from "./today-approvals-panel";

const { refreshMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
	refreshMock: vi.fn(),
	toastErrorMock: vi.fn(),
	toastSuccessMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock("@/navigation", () => ({
	Link: ({
		children,
		href,
		...props
	}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));
vi.mock("sonner", () => ({ toast: { success: toastSuccessMock, error: toastErrorMock } }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
				fallback,
			),
	}),
}));

describe("TodayApprovalsPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ success: true }),
		}) as unknown as typeof fetch;
	});
	it("ignores a decision completion from before Activity was hidden", async () => {
		let complete!: (value: unknown) => void;
		vi.mocked(global.fetch).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				}),
		);
		const items = [approvalItem()];
		const view = render(
			<Activity mode="visible">
				<TodayApprovalsPanel items={items} />
			</Activity>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Approve Vacation request" }));
		view.rerender(
			<Activity mode="hidden">
				<TodayApprovalsPanel items={items} />
			</Activity>,
		);
		view.rerender(
			<Activity mode="visible">
				<TodayApprovalsPanel items={items} />
			</Activity>,
		);
		await act(async () => complete({ ok: true, json: async () => ({ success: true }) }));
		expect(toastSuccessMock).not.toHaveBeenCalled();
		expect(refreshMock).not.toHaveBeenCalled();
	});

	it("approves an item inline and refreshes the briefing", async () => {
		render(<TodayApprovalsPanel items={[approvalItem()]} />);

		fireEvent.click(screen.getByRole("button", { name: /approve vacation request/i }));

		await waitFor(() =>
			expect(global.fetch).toHaveBeenCalledWith("/api/approvals/inbox/approval-1/approve", {
				method: "POST",
			}),
		);
		expect(toastSuccessMock).toHaveBeenCalledWith("Request approved");
		expect(refreshMock).toHaveBeenCalledTimes(1);
	});

	it("asks for a rejection reason in an action panel before sending anything", () => {
		render(<TodayApprovalsPanel items={[approvalItem()]} />);

		fireEvent.click(screen.getByRole("button", { name: /reject vacation request/i }));

		const panel = screen.getByRole("dialog", { name: "Reject request" });
		expect(within(panel).getByText("Vacation request")).toBeTruthy();
		expect(within(panel).getByLabelText("Reason for rejection")).toBeTruthy();
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it("refuses a blank or whitespace-only rejection reason", async () => {
		render(<TodayApprovalsPanel items={[approvalItem()]} />);
		fireEvent.click(screen.getByRole("button", { name: /reject vacation request/i }));
		const panel = screen.getByRole("dialog", { name: "Reject request" });
		const confirm = within(panel).getByRole("button", { name: "Confirm Rejection" });

		expect(confirm.hasAttribute("disabled")).toBe(true);
		fireEvent.change(within(panel).getByLabelText("Reason for rejection"), {
			target: { value: "   " },
		});

		expect(await within(panel).findByText("A reason is required")).toBeTruthy();
		expect(confirm.hasAttribute("disabled")).toBe(true);
		fireEvent.submit(confirm.closest("form") as HTMLFormElement);
		await act(async () => {});
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it("rejects with the manager's trimmed reason, closes the panel and refreshes the briefing", async () => {
		render(<TodayApprovalsPanel items={[approvalItem()]} />);
		fireEvent.click(screen.getByRole("button", { name: /reject vacation request/i }));
		const panel = screen.getByRole("dialog", { name: "Reject request" });

		fireEvent.change(within(panel).getByLabelText("Reason for rejection"), {
			target: { value: "  Overlaps the inventory week.  " },
		});
		fireEvent.click(within(panel).getByRole("button", { name: "Confirm Rejection" }));

		await waitFor(() =>
			expect(global.fetch).toHaveBeenCalledWith("/api/approvals/inbox/approval-1/reject", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ reason: "Overlaps the inventory week." }),
			}),
		);
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(toastSuccessMock).toHaveBeenCalledWith("Request rejected");
		expect(refreshMock).toHaveBeenCalledTimes(1);
	});

	it("keeps the panel and the manager's reason when the rejection fails", async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: false,
			json: async () => ({ success: false, error: "Already decided" }),
		}) as unknown as typeof fetch;
		render(<TodayApprovalsPanel items={[approvalItem()]} />);
		fireEvent.click(screen.getByRole("button", { name: /reject vacation request/i }));
		const panel = screen.getByRole("dialog", { name: "Reject request" });

		fireEvent.change(within(panel).getByLabelText("Reason for rejection"), {
			target: { value: "Overlaps the inventory week." },
		});
		fireEvent.click(within(panel).getByRole("button", { name: "Confirm Rejection" }));

		await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("Already decided"));
		const stillOpen = screen.getByRole("dialog", { name: "Reject request" });
		expect(
			(within(stillOpen).getByLabelText("Reason for rejection") as HTMLTextAreaElement).value,
		).toBe("Overlaps the inventory week.");
		expect(refreshMock).not.toHaveBeenCalled();
	});

	it("holds every other decision while a rejection is pending", async () => {
		let complete!: (value: unknown) => void;
		vi.mocked(global.fetch).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				}),
		);
		render(
			<TodayApprovalsPanel
				items={[
					approvalItem(),
					approvalItem({ id: "approval:approval-2", approvalId: "approval-2", title: "Sick day" }),
				]}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: /reject vacation request/i }));
		const panel = screen.getByRole("dialog", { name: "Reject request" });
		fireEvent.change(within(panel).getByLabelText("Reason for rejection"), {
			target: { value: "Overlaps the inventory week." },
		});
		fireEvent.click(within(panel).getByRole("button", { name: "Confirm Rejection" }));
		await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

		expect(
			screen
				.getByRole("button", { name: "Approve Sick day", hidden: true })
				.hasAttribute("disabled"),
		).toBe(true);

		await act(async () => complete({ ok: true, json: async () => ({ success: true }) }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it("sends a manager to the inbox instead of approving an item that needs detail review", () => {
		render(
			<TodayApprovalsPanel
				items={[
					approvalItem({
						title: "Expense report",
						href: "/approvals/inbox?types=travel_expense_report",
						requiresDetailReview: true,
					}),
				]}
			/>,
		);

		expect(screen.queryByRole("button", { name: /approve expense report/i })).toBeNull();
		expect(
			screen.getByRole("link", { name: "Review Expense report in inbox" }).getAttribute("href"),
		).toBe("/approvals/inbox?types=travel_expense_report");
		expect(screen.getByRole("button", { name: "Reject Expense report" })).toBeTruthy();
	});

	it("keeps the row visible when approval fails", async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ success: false, error: "Cannot approve" }),
		}) as unknown as typeof fetch;
		render(<TodayApprovalsPanel items={[approvalItem()]} />);

		fireEvent.click(screen.getByRole("button", { name: /approve vacation request/i }));

		expect(await screen.findByText("Vacation request")).toBeTruthy();
		expect(toastErrorMock).toHaveBeenCalledWith("Cannot approve");
		expect(refreshMock).not.toHaveBeenCalled();
	});

	it("shows a generic error when the server omits error copy", async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ success: false }),
		}) as unknown as typeof fetch;
		render(<TodayApprovalsPanel items={[approvalItem()]} />);

		fireEvent.click(screen.getByRole("button", { name: /reject vacation request/i }));
		const panel = screen.getByRole("dialog", { name: "Reject request" });
		fireEvent.change(within(panel).getByLabelText("Reason for rejection"), {
			target: { value: "Overlaps the inventory week." },
		});
		fireEvent.click(within(panel).getByRole("button", { name: "Confirm Rejection" }));

		await waitFor(() => {
			expect(toastErrorMock).toHaveBeenCalledWith("Unable to reject request");
		});
		expect(screen.getAllByText("Vacation request").length).toBeGreaterThan(0);
	});

	it("does not refresh when the approval response is not ok", async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: false,
			json: async () => ({ success: true, error: "Forbidden" }),
		}) as unknown as typeof fetch;
		render(<TodayApprovalsPanel items={[approvalItem()]} />);

		fireEvent.click(screen.getByRole("button", { name: /approve vacation request/i }));

		await waitFor(() => {
			expect(toastErrorMock).toHaveBeenCalledWith("Forbidden");
		});
		expect(screen.getByText("Vacation request")).toBeTruthy();
		expect(refreshMock).not.toHaveBeenCalled();
	});

	it("does not refresh when the approval payload is malformed", async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ success: "false" }),
		}) as unknown as typeof fetch;
		render(<TodayApprovalsPanel items={[approvalItem()]} />);

		fireEvent.click(screen.getByRole("button", { name: /approve vacation request/i }));

		await waitFor(() => {
			expect(toastErrorMock).toHaveBeenCalledWith("Unable to approve request");
		});
		expect(screen.getByText("Vacation request")).toBeTruthy();
		expect(refreshMock).not.toHaveBeenCalled();
	});

	it("offers no decisions on the viewer's own request", () => {
		render(
			<TodayApprovalsPanel
				items={[
					approvalItem({ id: "approval:own", title: "Own vacation request", ownRequest: true }),
					approvalItem(),
				]}
			/>,
		);

		expect(screen.getByText("Own vacation request")).toBeTruthy();
		expect(screen.getByText("Your own request: another approver decides it.")).toBeTruthy();
		expect(screen.queryByRole("button", { name: /own vacation request/i })).toBeNull();
		expect(screen.getByRole("button", { name: "Approve Vacation request" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Reject Vacation request" })).toBeTruthy();
	});

	it("renders the empty state", () => {
		render(<TodayApprovalsPanel items={[]} />);

		expect(screen.getByRole("heading", { name: "Approvals" })).toBeTruthy();
		expect(screen.getByText("No approvals are waiting."));
		expect(screen.getByRole("link", { name: "Open inbox" }).getAttribute("href")).toBe(
			"/approvals/inbox",
		);
	});
});

function approvalItem(
	overrides: Partial<BriefingApprovalActionItem> = {},
): BriefingApprovalActionItem {
	return {
		id: "approval:approval-1",
		category: "approval" as const,
		severity: "warning" as const,
		title: "Vacation request",
		description: "Apr 28",
		href: "/approvals/inbox?types=absence_entry",
		approvalId: "approval-1",
		approvalType: "absence_entry" as const,
		entityId: "absence-1",
		requesterName: "Ada Lovelace",
		summary: "Vacation on Apr 28",
		...overrides,
	};
}

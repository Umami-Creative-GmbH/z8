/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TodayApprovalsPanel } from "./today-approvals-panel";

const { refreshMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
	refreshMock: vi.fn(),
	toastErrorMock: vi.fn(),
	toastSuccessMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock("sonner", () => ({ toast: { success: toastSuccessMock, error: toastErrorMock } }));

describe("TodayApprovalsPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		global.fetch = vi.fn().mockResolvedValue({
			json: async () => ({ success: true }),
		}) as unknown as typeof fetch;
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

	it("rejects an item inline and refreshes the briefing", async () => {
		render(<TodayApprovalsPanel items={[approvalItem()]} />);

		fireEvent.click(screen.getByRole("button", { name: /reject vacation request/i }));

		await waitFor(() =>
			expect(global.fetch).toHaveBeenCalledWith("/api/approvals/inbox/approval-1/reject", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ reason: "Rejected from manager daily briefing." }),
			}),
		);
		expect(toastSuccessMock).toHaveBeenCalledWith("Request rejected");
		expect(refreshMock).toHaveBeenCalledTimes(1);
	});

	it("keeps the row visible when approval fails", async () => {
		global.fetch = vi.fn().mockResolvedValue({
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
			json: async () => ({ success: false }),
		}) as unknown as typeof fetch;
		render(<TodayApprovalsPanel items={[approvalItem()]} />);

		fireEvent.click(screen.getByRole("button", { name: /reject vacation request/i }));

		await waitFor(() => {
			expect(toastErrorMock).toHaveBeenCalledWith("Unable to reject request");
		});
		expect(screen.getByText("Vacation request")).toBeTruthy();
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

function approvalItem() {
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
	};
}

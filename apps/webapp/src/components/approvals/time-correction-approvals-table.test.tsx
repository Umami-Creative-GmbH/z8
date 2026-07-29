// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TimeCorrectionApprovalsTable } from "./time-correction-approvals-table";

const { actionMocks, approval, queryMocks, toastMocks } = vi.hoisted(() => ({
	actionMocks: {
		dispatchApprovalDecision: vi.fn(),
	},
	queryMocks: { getPendingApprovals: vi.fn() },
	toastMocks: { success: vi.fn(), error: vi.fn() },
	approval: {
		id: "approval-stable-1",
		entityId: "work-period-display-1",
		entityType: "time_entry",
		status: "pending" as const,
		reason: "Forgot to clock out after the customer visit",
		createdAt: new Date("2026-05-01T00:00:00.000Z"),
		displayContext: {
			locale: "en",
			timezone: "Europe/Berlin",
			timeFormat: "24h" as const,
		},
		requester: {
			user: {
				id: "user-1",
				name: "Ada Lovelace",
				email: "ada@example.com",
				image: null,
			},
		},
		workPeriod: {
			id: "work-period-display-1",
			startTime: new Date("2026-05-18T06:00:00.000Z"),
			endTime: new Date("2026-05-18T15:00:00.000Z"),
			clockInEntry: {
				timestamp: new Date("2026-05-18T06:00:00.000Z"),
				utcOffsetMinutes: 120,
			},
			clockOutEntry: {
				timestamp: new Date("2026-05-18T15:00:00.000Z"),
				utcOffsetMinutes: 120,
			},
			clockInCorrectionEntry: {
				timestamp: new Date("2026-05-18T06:15:00.000Z"),
				utcOffsetMinutes: 120,
			},
			clockOutCorrectionEntry: null,
		},
	},
}));

vi.mock("@/env", () => ({
	env: {
		BETTER_AUTH_SECRET: "test-secret-value-with-enough-length",
		NODE_ENV: "test",
	},
}));

vi.mock("@tolgee/react", () => ({
	useTolgee: () => ({ getLanguage: () => "en" }),
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/components/providers/user-preferences-provider", () => ({
	useTimeFormat: () => "24h",
}));

vi.mock("sonner", () => ({
	toast: toastMocks,
}));

vi.mock("@/app/[locale]/(app)/approvals/actions", () => ({
	getPendingApprovals: queryMocks.getPendingApprovals,
}));

vi.mock("@/lib/query/use-approval-inbox", () => ({
	dispatchApprovalDecision: actionMocks.dispatchApprovalDecision,
}));

function renderTable() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<TimeCorrectionApprovalsTable />
		</QueryClientProvider>,
	);
}

function lastButton(buttons: HTMLElement[]): HTMLElement {
	const button = buttons.at(-1);
	if (!button) throw new Error("Expected confirmation button");
	return button;
}

describe("TimeCorrectionApprovalsTable stable decision target", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		queryMocks.getPendingApprovals.mockResolvedValue({
			absenceApprovals: [],
			timeCorrectionApprovals: [approval],
		});
		actionMocks.dispatchApprovalDecision.mockImplementation(
			({
				approvalId,
				action,
			}: {
				approvalId: string;
				action: "approve" | "reject";
			}) =>
				Promise.resolve({
					success: true,
					result: {
						id: approvalId,
						type: "time_entry",
						status: action === "approve" ? "approved" : "rejected",
					},
				}),
		);
	});

	it.each([
		[
			"time correction",
			{ timeCorrection: { clockInCorrectionId: "correction-1" } },
		],
		[
			"manual time submission",
			{ timeRequest: { kind: "manual_time_submission" } },
		],
		["policy clock-out", { timeRequest: { kind: "policy_clock_out" } }],
	])("approves a %s through the canonical decision dispatcher", async (_label, metadata) => {
		const user = userEvent.setup();
		let resolveAction:
			| ((value: { success: true; result: object }) => void)
			| undefined;
		actionMocks.dispatchApprovalDecision.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveAction = resolve;
				}),
		);
		queryMocks.getPendingApprovals.mockResolvedValue({
			absenceApprovals: [],
			timeCorrectionApprovals: [{ ...approval, metadata }],
		});
		renderTable();

		await user.click(await screen.findByRole("button", { name: "Approve" }));
		const confirmations = screen.getAllByRole("button", { name: "Approve" });
		await user.click(lastButton(confirmations));

		await waitFor(() =>
			expect(actionMocks.dispatchApprovalDecision).toHaveBeenCalledWith({
				action: "approve",
				approvalId: "approval-stable-1",
			}),
		);
		await waitFor(() => expect(screen.queryByText("Ada Lovelace")).toBeNull());
		resolveAction?.({
			success: true,
			result: {
				id: "approval-stable-1",
				type: "time_entry",
				status: "approved",
			},
		});
	});

	it.each([
		[
			"time correction",
			{ timeCorrection: { clockInCorrectionId: "correction-1" } },
		],
		[
			"manual time submission",
			{ timeRequest: { kind: "manual_time_submission" } },
		],
		["policy clock-out", { timeRequest: { kind: "policy_clock_out" } }],
	])("rejects a %s through the canonical decision dispatcher", async (_label, metadata) => {
		const user = userEvent.setup();
		queryMocks.getPendingApprovals.mockResolvedValue({
			absenceApprovals: [],
			timeCorrectionApprovals: [{ ...approval, metadata }],
		});
		renderTable();

		await user.click(await screen.findByRole("button", { name: "Reject" }));
		await user.type(
			screen.getByRole("textbox", { name: "Reason for rejection *" }),
			"Incorrect shift",
		);
		const confirmations = screen.getAllByRole("button", { name: "Reject" });
		await user.click(lastButton(confirmations));

		await waitFor(() =>
			expect(actionMocks.dispatchApprovalDecision).toHaveBeenCalledWith({
				action: "reject",
				approvalId: "approval-stable-1",
				reason: "Incorrect shift",
			}),
		);
	});

	it("renders the request reason from the pending approval DTO", async () => {
		renderTable();

		expect(
			await screen.findByText("Forgot to clock out after the customer visit"),
		).not.toBeNull();
	});

	it("restores an optimistically removed request when canonical dispatch fails", async () => {
		const user = userEvent.setup();
		actionMocks.dispatchApprovalDecision.mockResolvedValue({
			success: false,
			error: "Request is already approved",
		});
		renderTable();

		await user.click(await screen.findByRole("button", { name: "Approve" }));
		const confirmations = screen.getAllByRole("button", { name: "Approve" });
		await user.click(lastButton(confirmations));

		await waitFor(() =>
			expect(screen.getByText("Ada Lovelace")).not.toBeNull(),
		);
		expect(toastMocks.error).toHaveBeenCalledWith(
			"Request is already approved",
		);
	});
});

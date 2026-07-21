// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TimeCorrectionApprovalsTable } from "./time-correction-approvals-table";

const { actionMocks, approval } = vi.hoisted(() => ({
	actionMocks: {
		approveTimeCorrection: vi.fn(),
		rejectTimeCorrection: vi.fn(),
	},
	approval: {
		id: "approval-stable-1",
		entityId: "work-period-display-1",
		entityType: "time_entry",
		status: "pending" as const,
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
	toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/app/[locale]/(app)/approvals/actions", () => ({
	getPendingApprovals: vi.fn().mockResolvedValue({
		absenceApprovals: [],
		timeCorrectionApprovals: [approval],
	}),
	approveTimeCorrection: actionMocks.approveTimeCorrection,
	rejectTimeCorrection: actionMocks.rejectTimeCorrection,
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
		actionMocks.approveTimeCorrection.mockResolvedValue({ success: true });
		actionMocks.rejectTimeCorrection.mockResolvedValue({ success: true });
	});

	it("approves by approval ID instead of the work-period display/cache ID", async () => {
		const user = userEvent.setup();
		let resolveAction: ((value: { success: true }) => void) | undefined;
		actionMocks.approveTimeCorrection.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveAction = resolve;
				}),
		);
		renderTable();

		await user.click(await screen.findByRole("button", { name: "Approve" }));
		const confirmations = screen.getAllByRole("button", { name: "Approve" });
		await user.click(lastButton(confirmations));

		await waitFor(() =>
			expect(actionMocks.approveTimeCorrection).toHaveBeenCalledWith(
				"approval-stable-1",
			),
		);
		expect(actionMocks.approveTimeCorrection).not.toHaveBeenCalledWith(
			"work-period-display-1",
		);
		await waitFor(() => expect(screen.queryByText("Ada Lovelace")).toBeNull());
		resolveAction?.({ success: true });
	});

	it("rejects by approval ID and preserves the entered reason", async () => {
		const user = userEvent.setup();
		renderTable();

		await user.click(await screen.findByRole("button", { name: "Reject" }));
		await user.type(
			screen.getByRole("textbox", { name: "Reason for rejection *" }),
			"Incorrect shift",
		);
		const confirmations = screen.getAllByRole("button", { name: "Reject" });
		await user.click(lastButton(confirmations));

		await waitFor(() =>
			expect(actionMocks.rejectTimeCorrection).toHaveBeenCalledWith(
				"approval-stable-1",
				"Incorrect shift",
			),
		);
		expect(actionMocks.rejectTimeCorrection).not.toHaveBeenCalledWith(
			"work-period-display-1",
			"Incorrect shift",
		);
	});
});

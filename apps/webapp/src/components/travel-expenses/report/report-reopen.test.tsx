/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const reopenActions = vi.hoisted(() => ({
	getTravelExpenseReportReopenState: vi.fn(),
	reopenTravelExpenseReportAction: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/report-reopen-actions", () => reopenActions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name) => String(params?.[name] ?? match)),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/navigation", () => ({ Link: () => null, useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/[locale]/(app)/travel-expenses/adjustment-actions", () => ({
	createTravelExpenseAdjustmentAction: vi.fn(),
	getTravelExpenseReportAdjustments: vi.fn(),
}));

import { ReopenedNotice, ReopenReportPanel } from "./report-reopen";

const reportId = "6a140000-0000-4000-8000-000000000001";

function mount() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<ReopenReportPanel reportId={reportId} />
		</QueryClientProvider>,
	);
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("reopening an approved report (#614)", () => {
	it("asks for a reason and reopens the current approved submission", async () => {
		reopenActions.getTravelExpenseReportReopenState.mockResolvedValue({
			success: true,
			data: { status: "available", submissionCycle: 2 },
		});
		reopenActions.reopenTravelExpenseReportAction.mockResolvedValue({
			success: true,
			data: { status: "reopened" },
		});
		mount();
		fireEvent.click(await screen.findByRole("button", { name: "Reopen for correction" }));
		const dialog = await screen.findByRole("dialog", { name: "Reopen this approved report?" });
		fireEvent.click(within(dialog).getByRole("button", { name: "Reopen report" }));
		expect(await within(dialog).findByText("Tell the employee what to correct.")).toBeTruthy();
		expect(reopenActions.reopenTravelExpenseReportAction).not.toHaveBeenCalled();

		fireEvent.change(within(dialog).getByLabelText(/Reason/), {
			target: { value: "Hotel invoice is missing" },
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "Reopen report" }));
		await waitFor(() =>
			expect(reopenActions.reopenTravelExpenseReportAction).toHaveBeenCalledWith({
				reportId,
				submissionCycle: 2,
				reason: "Hotel invoice is missing",
			}),
		);
		expect(toast.success).toHaveBeenCalledWith("Report reopened for correction");
	});

	it("points an exported or reimbursed report to an adjustment instead", async () => {
		reopenActions.getTravelExpenseReportReopenState.mockResolvedValue({
			success: true,
			data: { status: "adjustment_required", reason: "reimbursed" },
		});
		mount();
		expect(
			await screen.findByText(
				"A reimbursement was already recorded for this report, so it can no longer be reopened. Corrections need a linked adjustment.",
			),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Reopen for correction" })).toBeNull();
	});

	it("shows nothing to people who cannot reopen the report", async () => {
		reopenActions.getTravelExpenseReportReopenState.mockResolvedValue({
			success: true,
			data: { status: "unavailable" },
		});
		mount();
		await waitFor(() => expect(reopenActions.getTravelExpenseReportReopenState).toHaveBeenCalled());
		expect(screen.queryByRole("button")).toBeNull();
	});

	it("shows the employee why and by whom the report was reopened", () => {
		render(
			<ReopenedNotice
				reopened={{
					reason: "Wrong amount",
					reopenedAt: "2026-10-01T08:00:00Z",
					actorName: "Maria",
				}}
			/>,
		);
		expect(screen.getByText(/Reopened for correction by Maria/)).toBeTruthy();
		expect(screen.getByText("Wrong amount")).toBeTruthy();
	});
});

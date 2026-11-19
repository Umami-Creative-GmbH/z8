/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Activity } from "react";
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
	it("reserves native activation before validation and blocks duplicate submit and pending dismissal", async () => {
		reopenActions.getTravelExpenseReportReopenState.mockResolvedValue({
			success: true,
			data: { status: "available", submissionCycle: 2 },
		});
		let complete!: (value: unknown) => void;
		reopenActions.reopenTravelExpenseReportAction.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				}),
		);
		mount();
		fireEvent.click(await screen.findByRole("button", { name: "Reopen for correction" }));
		const dialog = await screen.findByRole("dialog");
		fireEvent.change(within(dialog).getByLabelText(/Reason/), {
			target: { value: "Exact pending reason" },
		});
		const form = within(dialog).getByRole("button", { name: "Reopen report" }).closest("form");
		if (!form) throw Error("Missing native form");
		fireEvent.submit(form);
		fireEvent.submit(form);
		fireEvent.keyDown(dialog, { key: "Escape" });
		await waitFor(() =>
			expect(reopenActions.reopenTravelExpenseReportAction).toHaveBeenCalledTimes(1),
		);
		expect(screen.getByRole("dialog")).toBeTruthy();
		await act(async () => complete({ success: false, error: "refused" }));
		expect(within(dialog).getByLabelText(/Reason/)).toHaveProperty("value", "Exact pending reason");
	});
	it("keeps a pending reason across Activity and retires the confirmation after a successful reopen", async () => {
		reopenActions.getTravelExpenseReportReopenState.mockResolvedValue({
			success: true,
			data: { status: "available", submissionCycle: 2 },
		});
		let complete!: (value: unknown) => void;
		reopenActions.reopenTravelExpenseReportAction.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				}),
		);
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const view = (mode: "visible" | "hidden") => (
			<QueryClientProvider client={client}>
				<Activity mode={mode}>
					<ReopenReportPanel reportId={reportId} />
				</Activity>
			</QueryClientProvider>
		);
		const rendered = render(view("visible"));
		fireEvent.click(await screen.findByRole("button", { name: "Reopen for correction" }));
		const dialog = await screen.findByRole("dialog");
		fireEvent.change(within(dialog).getByLabelText(/Reason/), {
			target: { value: "Activity keeps this reason" },
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "Reopen report" }));
		await waitFor(() =>
			expect(reopenActions.reopenTravelExpenseReportAction).toHaveBeenCalledTimes(1),
		);
		rendered.rerender(view("hidden"));
		rendered.rerender(view("visible"));
		expect(await screen.findByLabelText(/Reason/)).toHaveProperty(
			"value",
			"Activity keeps this reason",
		);
		const reads = reopenActions.getTravelExpenseReportReopenState.mock.calls.length;
		reopenActions.getTravelExpenseReportReopenState.mockResolvedValue({
			success: true,
			data: { status: "unavailable" },
		});
		await act(async () => complete({ success: true, data: { status: "reopened" } }));
		await waitFor(() => {
			expect(reopenActions.getTravelExpenseReportReopenState.mock.calls.length).toBeGreaterThan(
				reads,
			);
			expect(screen.queryByRole("dialog")).toBeNull();
			expect(screen.queryByRole("button", { name: "Reopen for correction" })).toBeNull();
		});
		expect(toast.success).not.toHaveBeenCalled();
		expect(reopenActions.reopenTravelExpenseReportAction).toHaveBeenCalledTimes(1);
	});
	it("keeps the exact reason and dialog after a rejected transport, then retries", async () => {
		reopenActions.getTravelExpenseReportReopenState.mockResolvedValue({
			success: true,
			data: { status: "available", submissionCycle: 2 },
		});
		reopenActions.reopenTravelExpenseReportAction
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce({ success: true, data: { status: "reopened" } });
		mount();
		fireEvent.click(await screen.findByRole("button", { name: "Reopen for correction" }));
		const dialog = await screen.findByRole("dialog");
		fireEvent.change(within(dialog).getByLabelText(/Reason/), {
			target: { value: "Keep invoice note exactly" },
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "Reopen report" }));
		expect(await within(dialog).findByText(/The report could not be reopened/)).toBeTruthy();
		expect(within(dialog).getByLabelText(/Reason/)).toHaveProperty(
			"value",
			"Keep invoice note exactly",
		);
		fireEvent.click(within(dialog).getByRole("button", { name: "Reopen report" }));
		await waitFor(() =>
			expect(reopenActions.reopenTravelExpenseReportAction).toHaveBeenCalledTimes(2),
		);
	});
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

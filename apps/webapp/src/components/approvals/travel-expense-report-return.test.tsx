/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reportActions = vi.hoisted(() => ({ getTravelExpenseReportSubmission: vi.fn() }));
const reviewActions = vi.hoisted(() => ({ returnTravelExpenseReportAction: vi.fn() }));
vi.mock("@/app/[locale]/(app)/travel-expenses/report-actions", () => reportActions);
vi.mock("@/app/[locale]/(app)/travel-expenses/report-review-actions", () => reviewActions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name) => String(params?.[name] ?? match)),
	}),
}));

import { TravelExpenseReportReturnButton } from "./travel-expense-report-return";

const approvalId = "6a030000-0000-4000-8000-000000000001";
const reportId = "6a030000-0000-4000-8000-000000000002";
const trainId = "6a030000-0000-4000-8000-000000000003";
const hotelId = "6a030000-0000-4000-8000-000000000004";

function item(itemId: string, description: string) {
	return {
		itemId,
		position: 0,
		type: "receipt",
		expenseDate: "2026-09-14",
		category: "transport",
		description,
		original: { amount: "10.00", currency: "EUR" },
		paidBy: "employee",
		accountingReference: null,
		receipts: [],
	};
}

function mount(onReturned = vi.fn()) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<TravelExpenseReportReturnButton
				approvalId={approvalId}
				reportId={reportId}
				disabled={false}
				onReturned={onReturned}
			/>
		</QueryClientProvider>,
	);
	return onReturned;
}

beforeEach(() => {
	reportActions.getTravelExpenseReportSubmission.mockResolvedValue({
		success: true,
		data: {
			facts: { items: [item(trainId, "Train to Hamburg"), item(hotelId, "Hotel Hamburg")] },
		},
	});
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("returning a travel expense report from the inbox (#603)", () => {
	it("requires a note before returning the report", async () => {
		mount();
		fireEvent.click(screen.getByRole("button", { name: "Return" }));
		const dialog = await screen.findByRole("dialog", { name: "Return report for changes" });
		await within(dialog).findByText("Hotel Hamburg");
		fireEvent.click(within(dialog).getByRole("button", { name: "Return for changes" }));

		expect(await within(dialog).findByText("Tell the employee what to change.")).toBeTruthy();
		expect(reviewActions.returnTravelExpenseReportAction).not.toHaveBeenCalled();
	});

	it("returns the whole report with a note and comments on the expenses to correct", async () => {
		reviewActions.returnTravelExpenseReportAction.mockResolvedValue({
			success: true,
			data: { status: "returned" },
		});
		const onReturned = mount();
		fireEvent.click(screen.getByRole("button", { name: "Return" }));
		const dialog = await screen.findByRole("dialog", { name: "Return report for changes" });
		await within(dialog).findByText("Hotel Hamburg");

		fireEvent.change(within(dialog).getByRole("textbox", { name: /Note to the employee/ }), {
			target: { value: "The hotel invoice is not itemized." },
		});
		fireEvent.change(within(dialog).getByRole("textbox", { name: "Receipt 2" }), {
			target: { value: "Upload the itemized invoice" },
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "Return for changes" }));

		await waitFor(() =>
			expect(reviewActions.returnTravelExpenseReportAction).toHaveBeenCalledWith({
				approvalId,
				note: "The hotel invoice is not itemized.",
				itemComments: [
					{ itemId: trainId, body: "" },
					{ itemId: hotelId, body: "Upload the itemized invoice" },
				],
			}),
		);
		await waitFor(() => expect(onReturned).toHaveBeenCalled());
		expect(toast.success).toHaveBeenCalledWith("Report returned for changes");
	});

	it("keeps the dialog open and explains a refused return", async () => {
		reviewActions.returnTravelExpenseReportAction.mockResolvedValue({
			success: false,
			error: "Approval request is no longer pending",
			code: "conflict",
		});
		const onReturned = mount();
		fireEvent.click(screen.getByRole("button", { name: "Return" }));
		const dialog = await screen.findByRole("dialog", { name: "Return report for changes" });
		await within(dialog).findByText("Hotel Hamburg");
		fireEvent.change(within(dialog).getByRole("textbox", { name: /Note to the employee/ }), {
			target: { value: "Fix it" },
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "Return for changes" }));

		// A translated outcome, never the server's English diagnostic.
		expect(
			await within(dialog).findByText(
				"This report was decided, returned or changed meanwhile. Reload it to see its current state.",
			),
		).toBeTruthy();
		expect(within(dialog).queryByText("Approval request is no longer pending")).toBeNull();
		expect(onReturned).not.toHaveBeenCalled();
	});
});

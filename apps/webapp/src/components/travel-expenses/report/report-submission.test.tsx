/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reportActions = vi.hoisted(() => ({
	getMyTravelExpenseReport: vi.fn(),
	getTravelExpenseReportSubmission: vi.fn(),
	submitTravelExpenseReportAction: vi.fn(),
	saveReceiptItemDraftAction: vi.fn(),
	removeReportReceiptAction: vi.fn(),
	saveTripDetailsDraftAction: vi.fn(),
	addTripReportItemAction: vi.fn(),
	removeTripReportItemAction: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/report-actions", () => reportActions);
vi.mock("@/hooks/use-travel-expense-file-upload", () => ({
	useTravelExpenseFileUpload: () => ({
		addFile: vi.fn(),
		progress: 0,
		isUploading: false,
		isProcessing: false,
		reset: vi.fn(),
	}),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback
				.replace(/\{count, plural, one \{# (\w+)\} other \{# (\w+)\}\}/, (_m, one, other) =>
					params?.count === 1 ? `1 ${one}` : `${String(params?.count)} ${other}`,
				)
				.replace(/\{(\w+)\}/g, (match, name) => String(params?.[name] ?? match)),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));

import { TravelExpenseReportEditor } from "./travel-expense-report-editor";

const reportId = "6a020000-0000-4000-8000-000000000001";
const trainId = "6a020000-0000-4000-8000-000000000002";
const hotelId = "6a020000-0000-4000-8000-000000000003";

function receipt(id: string, fileName: string) {
	return {
		id,
		fileName,
		mimeType: "application/pdf",
		sizeBytes: 4,
		createdAt: "2026-10-05T10:05:00.000Z",
	};
}

const train = {
	id: trainId,
	type: "receipt",
	version: 2,
	updatedAt: "2026-10-05T10:00:00.000Z",
	expenseDate: "2026-09-14",
	category: "transport",
	description: "Train to Hamburg",
	amount: "89.90",
	currency: "EUR",
	paidBy: "employee",
	accountingReference: null,
	receipts: [receipt("6a020000-0000-4000-8000-000000000009", "ticket.pdf")],
};
const hotel = {
	...train,
	id: hotelId,
	version: 4,
	expenseDate: "2026-09-15",
	category: "accommodation",
	description: "Hotel Hamburg",
	amount: "240.00",
	paidBy: "company",
	receipts: [receipt("6a020000-0000-4000-8000-00000000000a", "hotel.pdf")],
};

function tripReport(overrides: Record<string, unknown> = {}) {
	return {
		success: true,
		data: {
			id: reportId,
			kind: "trip",
			status: "draft",
			reimbursementCurrency: "EUR",
			createdAt: "2026-10-05T09:00:00.000Z",
			updatedAt: "2026-10-05T10:00:00.000Z",
			trip: {
				version: 5,
				purpose: "Customer workshop",
				startDate: "2026-09-14",
				endDate: "2026-09-16",
				timeZone: "Europe/Berlin",
				destinations: [{ place: "Hamburg", countryCode: "DE" }],
			},
			items: [train, hotel],
			...overrides,
		},
	};
}

function mount() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<TravelExpenseReportEditor reportId={reportId} maxReceiptBytes={1024} />
		</QueryClientProvider>,
	);
}

async function reviewButton() {
	return (await screen.findByRole("button", { name: "Review and submit" })) as HTMLButtonElement;
}

beforeEach(() => {
	reportActions.getMyTravelExpenseReport.mockResolvedValue(tripReport());
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("report submission", () => {
	it("submits exactly the saved report the employee reviewed", async () => {
		reportActions.submitTravelExpenseReportAction.mockResolvedValue({
			success: true,
			data: { status: "submitted" },
		});
		mount();
		fireEvent.click(await reviewButton());

		const dialog = await screen.findByRole("dialog", { name: "Submit expense report" });
		expect(within(dialog).getByText("Customer workshop")).toBeTruthy();
		expect(within(dialog).getByText("Train to Hamburg")).toBeTruthy();
		expect(within(dialog).getByText("Hotel Hamburg")).toBeTruthy();
		const totals = within(dialog).getByRole("region", { name: "Totals" });
		expect(within(totals).getByText("Reimbursed to you").nextElementSibling?.textContent).toBe(
			"€89.90",
		);
		expect(within(totals).getByText("Paid by the company").nextElementSibling?.textContent).toBe(
			"€240.00",
		);

		fireEvent.click(within(dialog).getByRole("button", { name: "Submit for approval" }));

		await waitFor(() =>
			expect(reportActions.submitTravelExpenseReportAction).toHaveBeenCalledWith({
				reportId,
				reviewed: {
					detailsVersion: 5,
					items: [
						{ id: trainId, version: 2, receiptIds: ["6a020000-0000-4000-8000-000000000009"] },
						{ id: hotelId, version: 4, receiptIds: ["6a020000-0000-4000-8000-00000000000a"] },
					],
				},
			}),
		);
		await waitFor(() => expect(toast.success).toHaveBeenCalled());
		// The page reloads the report, which is no longer an editable draft.
		await waitFor(() => expect(reportActions.getMyTravelExpenseReport).toHaveBeenCalledTimes(3));
	});

	it("keeps an incomplete report in draft and says why", async () => {
		reportActions.getMyTravelExpenseReport.mockResolvedValue(
			tripReport({ items: [train, { ...hotel, receipts: [] }] }),
		);
		mount();
		const button = await reviewButton();
		expect(button.disabled).toBe(true);
		expect(
			screen.getByText("Complete everything listed under “Still needed” before submitting."),
		).toBeTruthy();
	});

	it("explains missing reviewer setup without leaving the draft", async () => {
		reportActions.submitTravelExpenseReportAction.mockResolvedValue({
			success: true,
			data: { status: "no_reviewer", reason: "no_eligible_reviewer" },
		});
		mount();
		fireEvent.click(await reviewButton());
		const dialog = await screen.findByRole("dialog", { name: "Submit expense report" });
		fireEvent.click(within(dialog).getByRole("button", { name: "Submit for approval" }));

		const alert = await within(dialog).findByRole("alert");
		expect(alert.textContent).toContain("No one can review this report yet");
		expect(toast.success).not.toHaveBeenCalled();
	});

	it("asks for a fresh review when the report changed after it was reviewed", async () => {
		reportActions.submitTravelExpenseReportAction.mockResolvedValue({
			success: true,
			data: { status: "changed_since_review" },
		});
		mount();
		fireEvent.click(await reviewButton());
		const dialog = await screen.findByRole("dialog", { name: "Submit expense report" });
		fireEvent.click(within(dialog).getByRole("button", { name: "Submit for approval" }));

		expect((await within(dialog).findByRole("alert")).textContent).toContain(
			"changed after you reviewed it",
		);
	});

	it("shows a submitted report read-only instead of its draft forms", async () => {
		reportActions.getMyTravelExpenseReport.mockResolvedValue(
			tripReport({ status: "submitted" }),
		);
		reportActions.getTravelExpenseReportSubmission.mockResolvedValue({
			success: true,
			data: {
				reportId,
				status: "submitted",
				access: "owner",
				submittedAt: "2026-10-06T08:00:00.000Z",
				reviewerName: "Morgan Manager",
				decision: null,
				history: [
					{ id: "s", label: "submitted", at: "2026-10-06T08:00:00.000Z", actorName: "Avery" },
				],
				facts: {
					reportKind: "trip",
					reimbursementCurrency: "EUR",
					trip: {
						purpose: "Customer workshop",
						startDate: "2026-09-14",
						endDate: "2026-09-16",
						timeZone: "Europe/Berlin",
						destinations: [{ place: "Hamburg", countryCode: "DE" }],
					},
					items: [
						{
							itemId: trainId,
							position: 0,
							type: "receipt",
							expenseDate: "2026-09-14",
							category: "transport",
							description: "Train to Hamburg",
							original: { amount: "89.90", currency: "EUR" },
							paidBy: "employee",
							accountingReference: null,
							receipts: [{ receiptId: "r-1", fileName: "ticket.pdf" }],
						},
					],
					totals: { currency: "EUR", reimbursable: "89.90", companyPaid: "0.00" },
				},
			},
		});
		mount();

		expect(await screen.findByText("Awaiting review")).toBeTruthy();
		expect(screen.getByText("Morgan Manager", { exact: false })).toBeTruthy();
		expect(screen.queryByRole("textbox", { name: "Purpose of the trip" })).toBeNull();
		const link = screen.getByRole("link", { name: /ticket\.pdf/ });
		expect(link.getAttribute("href")).toBe(
			`/api/travel-expenses/reports/${reportId}/receipts/r-1`,
		);
	});
});

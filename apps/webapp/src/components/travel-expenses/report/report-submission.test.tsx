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
vi.mock("@/app/[locale]/(app)/travel-expenses/report-project-actions", () => ({
	getReportProjectChoicesAction: async () => ({
		success: true,
		data: { timeZone: "Europe/Berlin", choices: [], selected: null },
	}),
}));
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
vi.mock("@/app/[locale]/(app)/travel-expenses/report-review-actions", () => ({
	withdrawTravelExpenseReportAction: vi.fn(),
}));
// #615: the adjustment notices find no adjustment for these reports.
vi.mock("@/app/[locale]/(app)/travel-expenses/adjustment-actions", () => ({
	createTravelExpenseAdjustmentAction: vi.fn(),
	getTravelExpenseReportAdjustments: async () => ({ success: false, error: "Expense report not found" }),
}));
vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

import * as reviewActions from "@/app/[locale]/(app)/travel-expenses/report-review-actions";
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
	receiptException: { reason: null, version: 0 },
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
	it("shows each expense's project, inherited or its own, in the review step (#617)", async () => {
		reportActions.getMyTravelExpenseReport.mockResolvedValue(
			tripReport({
				projectId: "project-trip",
				projectNames: {
					"project-trip": { name: "Relaunch", customerName: "ACME" },
					"project-own": { name: "Audit", customerName: null },
				},
				items: [
					{ ...train, projectId: null, projectInherits: true },
					{ ...hotel, projectId: "project-own", projectInherits: false },
				],
			}),
		);
		mount();
		fireEvent.click(await reviewButton());
		const dialog = await screen.findByRole("dialog", { name: "Submit expense report" });
		const [first, second] = within(dialog).getAllByRole("listitem").filter((item) =>
			item.textContent?.includes("Hamburg"),
		);
		expect(first?.textContent).toContain("Relaunch · ACME");
		expect(first?.textContent).toContain("(trip project)");
		expect(second?.textContent).toContain("Audit");
		expect(second?.textContent).not.toContain("(trip project)");
	});

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
						{
							id: trainId,
							version: 2,
							receiptIds: ["6a020000-0000-4000-8000-000000000009"],
							receiptExceptionVersion: 0,
							amount: "89.90",
							referenceRate: null,
						},
						{
							id: hotelId,
							version: 4,
							receiptIds: ["6a020000-0000-4000-8000-00000000000a"],
							receiptExceptionVersion: 0,
							amount: "240.00",
							referenceRate: null,
						},
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

	function submittedView(overrides: Record<string, unknown> = {}) {
		return {
			success: true,
			data: {
				reportId,
				status: "submitted",
				access: "owner",
				submissionCycle: 1,
				latestCycle: 1,
				cycleOutcome: "pending",
				submittedAt: "2026-10-06T08:00:00.000Z",
				reviewerName: "Morgan Manager",
				decision: null,
				returned: null,
				cycles: [{ cycle: 1, submittedAt: "2026-10-06T08:00:00.000Z", outcome: "pending" }],
				history: [
					{
						id: "s",
						cycle: 1,
						label: "submitted",
						at: "2026-10-06T08:00:00.000Z",
						actorName: "Avery",
					},
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
				...overrides,
			},
		};
	}

	it("shows a submitted report read-only instead of its draft forms", async () => {
		reportActions.getMyTravelExpenseReport.mockResolvedValue(
			tripReport({ status: "submitted", submissionCount: 1 }),
		);
		reportActions.getTravelExpenseReportSubmission.mockResolvedValue(submittedView());
		mount();

		expect(await screen.findByText("Awaiting review")).toBeTruthy();
		expect(screen.getByText("Morgan Manager", { exact: false })).toBeTruthy();
		expect(screen.queryByRole("textbox", { name: "Purpose of the trip" })).toBeNull();
		const link = screen.getByRole("link", { name: /ticket\.pdf/ });
		// Each submission's receipts are the exact frozen files of that cycle (#603).
		expect(link.getAttribute("href")).toBe(
			`/api/travel-expenses/reports/${reportId}/receipts/r-1?cycle=1`,
		);
	});

	it("withdraws a pending submission after the employee confirms it", async () => {
		reportActions.getMyTravelExpenseReport.mockResolvedValue(
			tripReport({ status: "submitted", submissionCount: 1 }),
		);
		reportActions.getTravelExpenseReportSubmission.mockResolvedValue(submittedView());
		vi.mocked(reviewActions.withdrawTravelExpenseReportAction).mockResolvedValue({
			success: true,
			data: { status: "withdrawn" },
		});
		mount();

		fireEvent.click(await screen.findByRole("button", { name: "Withdraw report" }));
		const dialog = await screen.findByRole("alertdialog", { name: "Withdraw this report?" });
		fireEvent.click(within(dialog).getByRole("button", { name: "Withdraw" }));

		await waitFor(() =>
			expect(reviewActions.withdrawTravelExpenseReportAction).toHaveBeenCalledWith({
				reportId,
				submissionCycle: 1,
			}),
		);
		await waitFor(() => expect(toast.success).toHaveBeenCalled());
		// The report is reloaded and opens as an editable draft again.
		await waitFor(() => expect(reportActions.getMyTravelExpenseReport).toHaveBeenCalledTimes(2));
	});

	it("shows the reviewer's note and comments on a returned report and lets the employee correct and resubmit it", async () => {
		reportActions.getMyTravelExpenseReport.mockResolvedValue(
			tripReport({ status: "returned", submissionCount: 1 }),
		);
		reportActions.getTravelExpenseReportSubmission.mockResolvedValue(
			submittedView({
				status: "returned",
				cycleOutcome: "returned",
				reviewerName: null,
				returned: {
					note: "The hotel invoice is not itemized.",
					returnedAt: "2026-10-06T09:00:00.000Z",
					reviewerName: "Morgan Manager",
					itemComments: [
						{
							itemId: hotelId,
							number: 2,
							description: "Hotel Hamburg",
							body: "Upload the itemized invoice",
						},
					],
				},
				cycles: [{ cycle: 1, submittedAt: "2026-10-06T08:00:00.000Z", outcome: "returned" }],
			}),
		);
		mount();

		expect(await screen.findByText("The hotel invoice is not itemized.")).toBeTruthy();
		expect(screen.getByText("Upload the itemized invoice")).toBeTruthy();
		expect(screen.getByText("Returned for changes")).toBeTruthy();
		// The earlier submission stays readable.
		expect(
			screen
				.getByRole("link", { name: /Submission 1 on .*returned for changes/ })
				.getAttribute("href"),
		).toBe(`/travel-expenses/reports/${reportId}?cycle=1`);
		// The returned report is edited and submitted like a draft.
		expect(screen.getByRole("textbox", { name: "Purpose of the trip" })).toBeTruthy();
		expect((await reviewButton()).disabled).toBe(false);
	});
});

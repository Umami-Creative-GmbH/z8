/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TravelExpenseExportsView } from "@/app/[locale]/(app)/travel-expenses/finance-export-actions";
import type { TravelExpenseExportBatchView } from "@/lib/travel-expenses/export-store";
import type { SettlementAccount } from "@/lib/travel-expenses/settlement-store";

const mocks = vi.hoisted(() => ({
	getExports: vi.fn(),
	create: vi.fn(),
	retry: vi.fn(),
	cancel: vi.fn(),
	getReimbursement: vi.fn(),
	markReimbursed: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? "")),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/[locale]/(app)/travel-expenses/finance-export-actions", () => ({
	getTravelExpenseExports: mocks.getExports,
	createTravelExpenseExportAction: mocks.create,
	retryTravelExpenseExportAction: mocks.retry,
	cancelTravelExpenseExportAction: mocks.cancel,
	getTravelExpenseExportReimbursement: mocks.getReimbursement,
	markTravelExpenseExportReimbursedAction: mocks.markReimbursed,
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/finance-actions", () => ({
	markTravelExpensesReimbursedAction: vi.fn(),
}));
// A plain date input stands in for the calendar popover.
vi.mock("@/components/ui/date-picker", () => ({
	DatePicker: ({
		value,
		onChange,
		...props
	}: {
		value: string;
		onChange: (value: string) => void;
	} & Record<string, unknown>) => (
		<input {...props} value={value} onChange={(event) => onChange(event.target.value)} />
	),
}));

import { FinanceExports } from "./finance-exports";

const batch: TravelExpenseExportBatchView = {
	id: "batch-1",
	status: "completed",
	attempt: 1,
	revisionCount: 1,
	itemCount: 2,
	receiptCount: 2,
	totals: [{ currency: "EUR", reimbursable: "89.90", companyPaid: "240.00" }],
	manifestDigest: "travel_expense_export:v1:abc",
	requestedAt: "2026-10-01T12:00:00Z",
	requestedByName: "Fin",
	startedAt: "2026-10-01T12:00:01Z",
	completedAt: "2026-10-01T12:00:02Z",
	failedAt: null,
	errorCode: null,
	cancelledAt: null,
	cancelReason: null,
	fileName: "travel-expenses-2026-10-01-batch-1.zip",
	sizeBytes: 2048,
	checksumSha256: "f".repeat(64),
	retryable: false,
	cancellable: false,
	reports: [],
};

const account: SettlementAccount = {
	source: { type: "report", id: "report-robin" },
	organizationId: "org",
	employeeId: "employee",
	employeeName: "Robin",
	approved: true,
	currency: "EUR",
	basis: null,
	entitlement: [{ kind: "approved_submission", id: "revision", currency: "EUR", amount: "89.90" }],
	entries: [],
	summary: {
		state: "outstanding",
		currencies: [
			{
				currency: "EUR",
				entitlement: "89.90",
				reimbursed: "0.00",
				recovered: "0.00",
				balance: "89.90",
				state: "outstanding",
			},
		],
	},
	title: { kind: "trip", purpose: "Customer workshop", startDate: null, endDate: null },
	adjustments: [],
	adjustmentOf: null,
	adjustmentDelta: null,
};

function view(overrides: Partial<TravelExpenseExportsView> = {}): TravelExpenseExportsView {
	return {
		exportable: [
			{
				reportId: "11111111-1111-4111-8111-111111111111",
				revisionId: "22222222-2222-4222-8222-222222222222",
				submissionCycle: 1,
				employeeName: "Robin",
				title: {
					kind: "trip",
					purpose: "Customer workshop",
					startDate: "2026-09-14",
					endDate: "2026-09-16",
				},
				approvedAt: "2026-09-20T10:00:00Z",
				currency: "EUR",
				reimbursable: "89.90",
				companyPaid: "240.00",
				settlement: "outstanding",
			},
		],
		batches: [],
		maxRevisions: 100,
		canSettle: false,
		...overrides,
	};
}

function mount() {
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<FinanceExports />
		</QueryClientProvider>,
	);
}

describe("finance exports (#613)", () => {
	beforeEach(() => {
		for (const mock of Object.values(mocks)) mock.mockReset();
	});
	afterEach(cleanup);

	it("exports the selected approved revisions and keeps one idempotency key across a retry", async () => {
		mocks.getExports.mockResolvedValue({ success: true, data: view() });
		mocks.create
			.mockResolvedValueOnce({ success: false, error: "Failed to create the export" })
			.mockResolvedValueOnce({
				success: true,
				data: { status: "created", replayed: false, batchId: "batch-1" },
			});
		mount();
		const create = await screen.findByRole("button", { name: /Create export/ });
		expect((create as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(screen.getByRole("checkbox", { name: /Robin · Customer workshop/ }));
		expect(
			screen.getByText("Not a payment: exporting does not mark anything as reimbursed."),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Create export (1)" }));
		await screen.findByText("The export could not be created. Please retry.");
		fireEvent.click(screen.getByRole("button", { name: "Create export (1)" }));
		await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
		const [first] = mocks.create.mock.calls[0] ?? [];
		const [second] = mocks.create.mock.calls[1] ?? [];
		expect(first.selection).toEqual([
			{
				reportId: "11111111-1111-4111-8111-111111111111",
				revisionId: "22222222-2222-4222-8222-222222222222",
			},
		]);
		expect(second.idempotencyKey).toBe(first.idempotencyKey);
	});

	it("shows each batch outcome with download, retry and cancel where they apply", async () => {
		mocks.getExports.mockResolvedValue({
			success: true,
			data: view({
				exportable: [],
				batches: [
					batch,
					{
						...batch,
						id: "batch-2",
						status: "failed",
						errorCode: "receipt_unavailable",
						retryable: true,
						cancellable: true,
						fileName: null,
					},
					{ ...batch, id: "batch-3", status: "queued", cancellable: true, fileName: null },
				],
			}),
		});
		mocks.retry.mockResolvedValue({ success: true, data: { status: "queued" } });
		mount();
		const download = await screen.findByRole("link", { name: /Download/ });
		expect(download.getAttribute("href")).toBe("/api/travel-expenses/exports/batch-1");
		expect(screen.getByText("Completed")).toBeTruthy();
		expect(screen.getByText("Failed")).toBeTruthy();
		expect(screen.getByText("Queued")).toBeTruthy();
		expect(
			screen.getByText("A receipt file could not be read. Retry once storage is available."),
		).toBeTruthy();
		expect(screen.getByText("No approved expenses are waiting for export.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith("batch-2"));
		expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(2);
	});

	it("explains a batch cancelled by a reopened report and points finance to a new export", async () => {
		const cancelled = {
			...batch,
			status: "cancelled" as const,
			cancelledAt: "2026-10-02T09:00:00Z",
			fileName: null,
		};
		mocks.getExports.mockResolvedValue({
			success: true,
			data: view({
				exportable: [],
				batches: [
					{ ...cancelled, id: "batch-4", cancelReason: "report_reopened" },
					{ ...cancelled, id: "batch-5", cancelReason: "cancelled_by_finance" },
				],
			}),
		});
		mount();
		expect(
			await screen.findByText(
				"Cancelled because a report in it was reopened for correction. Any other reports in it are ready to export again: create a new export for them.",
			),
		).toBeTruthy();
		expect(screen.getByText("Cancelled by finance.")).toBeTruthy();
		expect(screen.queryByRole("link", { name: /Download/ })).toBeNull();
	});

	it("marks a completed batch as reimbursed, listing the accounts it skips with every result", async () => {
		mocks.getExports.mockResolvedValue({
			success: true,
			data: view({ exportable: [], batches: [batch], canSettle: true }),
		});
		mocks.getReimbursement.mockResolvedValue({
			success: true,
			data: {
				status: "ready",
				accounts: [
					{
						source: { type: "report", id: "report-robin" },
						employeeName: "Robin",
						title: account.title,
						account,
						skip: null,
					},
					{
						source: { type: "report", id: "report-sam" },
						employeeName: "Sam",
						title: { kind: "standalone", description: "Taxi", expenseDate: "2026-09-02" },
						account: null,
						skip: "out_of_scope",
					},
				],
			},
		});
		mocks.markReimbursed.mockResolvedValue({
			success: true,
			data: {
				status: "processed",
				rows: [
					{
						source: { type: "report", id: "report-robin" },
						outcome: "reimbursed",
						replayed: false,
						amount: "89.90",
						currency: "EUR",
					},
				],
			},
		});
		const user = userEvent.setup();
		mount();
		await user.click(await screen.findByRole("button", { name: "Mark as reimbursed" }));
		expect(mocks.getReimbursement).toHaveBeenCalledWith("batch-1");
		const dialog = await screen.findByRole("dialog");
		expect(
			within(dialog).getByText(/Adjustments count toward the report they correct/),
		).toBeTruthy();
		expect(within(dialog).getByText("Not included (1)")).toBeTruthy();
		expect(within(dialog).getByText("Sam · Taxi")).toBeTruthy();
		expect(within(dialog).getByText("Skipped: out of scope")).toBeTruthy();
		await user.type(within(dialog).getByLabelText(/^Payment reference/), "SEPA-7");
		await user.click(within(dialog).getByRole("button", { name: "Mark 1 as reimbursed" }));

		await within(dialog).findByText("1 of 2 reimbursed");
		expect(mocks.markReimbursed).toHaveBeenCalledWith(
			expect.objectContaining({
				batchId: "batch-1",
				reference: "SEPA-7",
				accounts: [
					{
						source: { type: "report", id: "report-robin" },
						expectedBalance: { currency: "EUR", amount: "89.90" },
					},
				],
			}),
		);
		expect(within(dialog).getByText("Robin · Customer workshop")).toBeTruthy();
		expect(within(dialog).getByText(/^Reimbursed /)).toBeTruthy();
		expect(within(dialog).getByText("Skipped: out of scope")).toBeTruthy();
	});

	it("records nothing for a batch whose accounts were all reimbursed already", async () => {
		mocks.getExports.mockResolvedValue({
			success: true,
			data: view({ exportable: [], batches: [batch], canSettle: true }),
		});
		mocks.getReimbursement.mockResolvedValue({
			success: true,
			data: {
				status: "ready",
				accounts: [
					{
						source: { type: "report", id: "report-robin" },
						employeeName: "Robin",
						title: account.title,
						account,
						skip: "already_reimbursed",
					},
				],
			},
		});
		const user = userEvent.setup();
		mount();
		await user.click(await screen.findByRole("button", { name: "Mark as reimbursed" }));
		const dialog = await screen.findByRole("dialog");
		expect(
			within(dialog).getByText(
				"Nothing here awaits reimbursement in full. No payment is recorded.",
			),
		).toBeTruthy();
		expect(within(dialog).getByText("Skipped: already reimbursed")).toBeTruthy();
		expect(within(dialog).queryByRole("button", { name: /as reimbursed/ })).toBeNull();
		// The footer's Close and the dialog's own close button both close it.
		const [close] = within(dialog).getAllByRole("button", { name: "Close" });
		if (close) await user.click(close);
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(mocks.markReimbursed).not.toHaveBeenCalled();
	});

	it("offers Mark as reimbursed only on completed batches, to users who record reimbursements", async () => {
		mocks.getExports.mockResolvedValue({
			success: true,
			data: view({
				exportable: [],
				batches: [batch, { ...batch, id: "batch-2", status: "queued", fileName: null }],
				canSettle: true,
			}),
		});
		mount();
		expect(await screen.findAllByRole("button", { name: "Mark as reimbursed" })).toHaveLength(1);
		cleanup();

		mocks.getExports.mockResolvedValue({
			success: true,
			data: view({ exportable: [], batches: [batch], canSettle: false }),
		});
		mount();
		await screen.findByRole("link", { name: /Download/ });
		expect(screen.queryByRole("button", { name: "Mark as reimbursed" })).toBeNull();
	});

	it("offers retry when the exports fail to load", async () => {
		mocks.getExports
			.mockResolvedValueOnce({ success: false, error: "Failed to load exports" })
			.mockResolvedValueOnce({ success: true, data: view({ exportable: [] }) });
		mount();
		fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
		await screen.findByText("No approved expenses are waiting for export.");
	});
});

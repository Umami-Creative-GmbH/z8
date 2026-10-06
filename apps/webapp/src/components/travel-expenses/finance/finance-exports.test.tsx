/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TravelExpenseExportsView } from "@/app/[locale]/(app)/travel-expenses/finance-export-actions";
import type { TravelExpenseExportBatchView } from "@/lib/travel-expenses/export-store";

const mocks = vi.hoisted(() => ({
	getExports: vi.fn(),
	create: vi.fn(),
	retry: vi.fn(),
	cancel: vi.fn(),
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

	it("offers retry when the exports fail to load", async () => {
		mocks.getExports
			.mockResolvedValueOnce({ success: false, error: "Failed to load exports" })
			.mockResolvedValueOnce({ success: true, data: view({ exportable: [] }) });
		mount();
		fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
		await screen.findByText("No approved expenses are waiting for export.");
	});
});

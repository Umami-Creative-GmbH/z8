/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reportActions = vi.hoisted(() => ({
	getMyTravelExpenseReport: vi.fn(),
	saveReceiptItemDraftAction: vi.fn(),
	removeReportReceiptAction: vi.fn(),
	deleteDraftTravelExpenseReportAction: vi.fn(),
}));
const legacyDraftActions = vi.hoisted(() => ({
	getLegacyTravelExpenseConversion: vi.fn(async () => ({ success: true, data: null })),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/legacy-draft-actions", () => legacyDraftActions);
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/[locale]/(app)/travel-expenses/report-actions", () => reportActions);
vi.mock("@/app/[locale]/(app)/travel-expenses/report-project-actions", () => ({
	getReportProjectChoicesAction: async () => ({
		success: true,
		data: { timeZone: "Europe/Berlin", choices: [], selected: null },
	}),
}));

const upload = vi.hoisted(() => ({
	options: null as null | {
		process: (input: { tusFileKey: string; fileName: string | undefined }) => Promise<unknown>;
		onSuccess?: (result: unknown) => void;
		onError?: (error: Error) => void;
	},
	addFile: vi.fn(),
	maxFileSize: undefined as number | undefined,
}));
vi.mock("@/hooks/use-travel-expense-file-upload", () => ({
	useTravelExpenseFileUpload: (
		options: NonNullable<typeof upload.options> & { maxFileSize?: number },
	) => {
		upload.maxFileSize = options.maxFileSize;
		upload.options = options;
		return {
			addFile: upload.addFile,
			progress: 0,
			isUploading: false,
			isProcessing: false,
			reset: vi.fn(),
		};
	},
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name) => String(params?.[name] ?? match)),
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
	useRouter: () => router,
}));

import { TravelExpenseReportEditor } from "./travel-expense-report-editor";

const reportId = "6a000000-0000-4000-8000-000000000001";
const itemId = "6a000000-0000-4000-8000-000000000002";

function item(overrides: Record<string, unknown> = {}) {
	return {
		id: itemId,
		type: "receipt",
		version: 3,
		updatedAt: "2026-10-05T10:00:00.000Z",
		expenseDate: "2026-09-14",
		category: "accommodation",
		description: "Hotel Hamburg",
		amount: "129.90",
		currency: "EUR",
		paidBy: "employee",
		accountingReference: null,
		receiptException: { reason: null, version: 0 },
		receipts: [] as unknown[],
		...overrides,
	};
}

function report(itemOverrides: Record<string, unknown> = {}) {
	return {
		success: true,
		data: {
			id: reportId,
			kind: "standalone",
			status: "draft",
			reimbursementCurrency: "EUR",
			createdAt: "2026-10-05T09:00:00.000Z",
			updatedAt: "2026-10-05T10:00:00.000Z",
			items: [item(itemOverrides)],
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
	return client;
}

async function description() {
	return (await screen.findByRole("textbox", { name: "Description" })) as HTMLTextAreaElement;
}

beforeEach(() => {
	reportActions.getMyTravelExpenseReport.mockResolvedValue(report());
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	upload.options = null;
});

describe("TravelExpenseReportEditor", () => {
	it("restores saved fields on load and shows what is still needed", async () => {
		mount();
		expect((await description()).value).toBe("Hotel Hamburg");
		expect(screen.getByRole("textbox", { name: "Amount on the receipt" })).toHaveProperty(
			"value",
			"129.90",
		);
		expect(screen.getByRole("status")).toHaveProperty("textContent", "All changes saved");
		expect(screen.getByText("Attach the receipt.")).toBeTruthy();
		const totals = screen.getByRole("region", { name: "Totals" });
		expect(within(totals).getByText("€129.90")).toBeTruthy();
	});

	it("keeps a future-dated receipt from being submitted and says from when (#685)", async () => {
		reportActions.getMyTravelExpenseReport.mockResolvedValue(
			report({
				expenseDate: "2099-01-15",
				receipts: [
					{
						id: "6a000000-0000-4000-8000-000000000003",
						fileName: "invoice.pdf",
						mimeType: "application/pdf",
						sizeBytes: 4,
						createdAt: "2026-10-05T10:05:00.000Z",
					},
				],
			}),
		);
		mount();
		expect(
			await screen.findByText(
				"This date is in the future. Correct it, or submit from Jan 15, 2099.",
			),
		).toBeTruthy();
		expect(screen.queryByText("Attach the receipt.")).toBeNull();
		expect(
			(screen.getByRole("button", { name: "Review and submit" }) as HTMLButtonElement).disabled,
		).toBe(true);
	});

	it("autosaves edits on the loaded version and reports saving, then saved", async () => {
		let finishSave!: (value: unknown) => void;
		reportActions.saveReceiptItemDraftAction.mockImplementationOnce(
			() => new Promise((resolve) => (finishSave = resolve)),
		);
		mount();
		fireEvent.change(await description(), { target: { value: "Hotel Hamburg, 2 nights" } });
		expect(screen.getByRole("status").textContent).toBe("Unsaved changes");

		await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saving…"), {
			timeout: 2000,
		});
		expect(reportActions.saveReceiptItemDraftAction).toHaveBeenCalledWith({
			reportId,
			itemId,
			expectedVersion: 3,
			values: expect.objectContaining({
				description: "Hotel Hamburg, 2 nights",
				amount: "129.90",
				accountingReference: null,
			}),
		});
		await act(async () => {
			finishSave({ success: true, data: { status: "saved", item: item({ version: 4 }) } });
		});
		expect(screen.getByRole("status").textContent).toBe("All changes saved");
	});

	it("keeps edits after a failed save and saves them again on retry", async () => {
		reportActions.saveReceiptItemDraftAction
			.mockResolvedValueOnce({ success: false, error: "Failed to save expense draft" })
			.mockResolvedValueOnce({
				success: true,
				data: { status: "saved", item: item({ version: 4 }) },
			});
		mount();
		fireEvent.change(await description(), { target: { value: "Changed offline" } });

		expect(
			await screen.findByText("Your changes could not be saved", {}, { timeout: 2000 }),
		).toBeTruthy();
		expect((await description()).value).toBe("Changed offline");

		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		await waitFor(() => expect(screen.getByRole("status").textContent).toBe("All changes saved"));
		expect(reportActions.saveReceiptItemDraftAction).toHaveBeenLastCalledWith(
			expect.objectContaining({
				expectedVersion: 3,
				values: expect.objectContaining({ description: "Changed offline" }),
			}),
		);
	});

	it("does not overwrite a newer version and can load it instead", async () => {
		reportActions.saveReceiptItemDraftAction.mockResolvedValueOnce({
			success: true,
			data: { status: "conflict", item: item({ version: 7, description: "Edited on phone" }) },
		});
		mount();
		fireEvent.change(await description(), { target: { value: "Edited on laptop" } });

		expect(
			await screen.findByText("This expense changed elsewhere", {}, { timeout: 2000 }),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Load the saved version" }));
		expect((await description()).value).toBe("Edited on phone");
		expect(screen.getByRole("status").textContent).toBe("All changes saved");
		expect(reportActions.saveReceiptItemDraftAction).toHaveBeenCalledTimes(1);
	});

	it("flags a malformed amount but still saves the valid edits", async () => {
		reportActions.saveReceiptItemDraftAction.mockResolvedValueOnce({
			success: true,
			data: { status: "saved", item: item({ version: 4, description: "Hotel Kiel" }) },
		});
		mount();
		fireEvent.change(await description(), { target: { value: "Hotel Kiel" } });
		fireEvent.change(screen.getByRole("textbox", { name: "Amount on the receipt" }), {
			target: { value: "12.345" },
		});
		expect(
			await screen.findByText(
				"Enter a positive amount with at most two decimals, e.g. 12.50.",
				{},
				{ timeout: 2000 },
			),
		).toBeTruthy();
		expect(screen.getByRole("status").textContent).toBe(
			"Correct the highlighted fields to save them",
		);
		// The malformed amount keeps its last saved value; the description is saved.
		expect(reportActions.saveReceiptItemDraftAction).toHaveBeenCalledWith(
			expect.objectContaining({
				expectedVersion: 3,
				values: expect.objectContaining({ description: "Hotel Kiel", amount: "129.90" }),
			}),
		);
		expect(screen.getByRole("textbox", { name: "Amount on the receipt" })).toHaveProperty(
			"value",
			"12.345",
		);
	});

	it("separates company-paid costs from the reimbursement total", async () => {
		reportActions.getMyTravelExpenseReport.mockResolvedValue(report({ paidBy: "company" }));
		mount();
		await description();
		const totals = screen.getByRole("region", { name: "Totals" });
		expect(within(totals).getByText("Reimbursed to you").nextElementSibling?.textContent).toBe(
			"€0.00",
		);
		expect(within(totals).getByText("Paid by the company").nextElementSibling?.textContent).toBe(
			"€129.90",
		);
	});

	it("shows a failed upload and refreshes the receipts after a successful one", async () => {
		mount();
		await description();
		const input = screen.getByTestId("receipt-file-input");
		fireEvent.change(input, {
			target: { files: [new File(["%PDF"], "hotel.pdf", { type: "application/pdf" })] },
		});
		expect(upload.addFile).toHaveBeenCalledWith(expect.objectContaining({ name: "hotel.pdf" }));
		// The uploader refuses files above the server limit before uploading.
		expect(upload.maxFileSize).toBe(1024);

		// The uploader's own English wording is never shown.
		act(() => upload.options?.onError?.(new Error("Network glitch")));
		expect(screen.getByText(/The receipt was not attached\. Please try again\./)).toBeTruthy();
		expect(screen.queryByText(/Network glitch/)).toBeNull();

		reportActions.getMyTravelExpenseReport.mockResolvedValue(
			report({
				receipts: [
					{
						id: "6a000000-0000-4000-8000-000000000003",
						fileName: "hotel.pdf",
						mimeType: "application/pdf",
						sizeBytes: 4,
						createdAt: "2026-10-05T10:05:00.000Z",
					},
				],
			}),
		);
		act(() => upload.options?.onSuccess?.({}));
		expect(await screen.findByText("hotel.pdf")).toBeTruthy();
		expect(screen.queryByText("Attach the receipt.")).toBeNull();
	});

	it("previews and removes a receipt, keeping a failed removal visible", async () => {
		const receipt = {
			id: "6a000000-0000-4000-8000-000000000003",
			fileName: "taxi.jpg",
			mimeType: "image/jpeg",
			sizeBytes: 4,
			createdAt: "2026-10-05T10:05:00.000Z",
		};
		reportActions.getMyTravelExpenseReport.mockResolvedValue(report({ receipts: [receipt] }));
		mount();
		const preview = await screen.findByRole("link", { name: "Preview taxi.jpg" });
		expect(preview.getAttribute("href")).toBe(
			`/api/travel-expenses/reports/${reportId}/receipts/${receipt.id}`,
		);
		expect(screen.getByRole("link", { name: "Download taxi.jpg" }).getAttribute("href")).toBe(
			`/api/travel-expenses/reports/${reportId}/receipts/${receipt.id}?download=1`,
		);

		reportActions.removeReportReceiptAction.mockResolvedValueOnce({
			success: false,
			error: "This expense can no longer be edited",
		});
		fireEvent.click(screen.getByRole("button", { name: "Remove taxi.jpg" }));
		expect(await screen.findByText(/This expense can no longer be edited/)).toBeTruthy();
		expect(screen.getByText("taxi.jpg")).toBeTruthy();

		reportActions.removeReportReceiptAction.mockResolvedValueOnce({
			success: true,
			data: { receiptId: receipt.id },
		});
		reportActions.getMyTravelExpenseReport.mockResolvedValue(report({ receipts: [] }));
		fireEvent.click(screen.getByRole("button", { name: "Remove taxi.jpg" }));
		await waitFor(() => expect(screen.queryByText("taxi.jpg")).toBeNull());
		expect(reportActions.removeReportReceiptAction).toHaveBeenLastCalledWith({
			reportId,
			itemId,
			receiptId: receipt.id,
		});
	});

	it("offers a retry when the report cannot be loaded", async () => {
		reportActions.getMyTravelExpenseReport
			.mockResolvedValueOnce({ success: false, error: "Failed to load expense report" })
			.mockResolvedValueOnce(report());
		mount();
		fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
		expect((await description()).value).toBe("Hotel Hamburg");
	});
});

describe("deleting a draft (#684)", () => {
	function withSubmissions(submissionCount: number) {
		const loaded = report();
		return { ...loaded, data: { ...loaded.data, submissionCount } };
	}

	it("deletes a never-submitted draft after confirmation and returns to the expenses", async () => {
		reportActions.getMyTravelExpenseReport.mockResolvedValue(withSubmissions(0));
		reportActions.deleteDraftTravelExpenseReportAction.mockResolvedValueOnce({
			success: true,
			data: { reportId },
		});
		mount();
		fireEvent.click(await screen.findByRole("button", { name: "Delete draft" }));
		const dialog = await screen.findByRole("alertdialog");
		expect(dialog.textContent).toContain("This cannot be undone.");
		expect(reportActions.deleteDraftTravelExpenseReportAction).not.toHaveBeenCalled();

		fireEvent.click(within(dialog).getByRole("button", { name: "Delete draft" }));
		await waitFor(() => expect(router.push).toHaveBeenCalledWith("/travel-expenses"));
		expect(reportActions.deleteDraftTravelExpenseReportAction).toHaveBeenCalledWith({ reportId });
	});

	it("keeps a cancelled draft", async () => {
		reportActions.getMyTravelExpenseReport.mockResolvedValue(withSubmissions(0));
		mount();
		fireEvent.click(await screen.findByRole("button", { name: "Delete draft" }));
		fireEvent.click(
			within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }),
		);
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
		expect(reportActions.deleteDraftTravelExpenseReportAction).not.toHaveBeenCalled();
	});

	it("does not offer deleting a draft that was submitted before", async () => {
		reportActions.getMyTravelExpenseReport.mockResolvedValue(withSubmissions(1));
		mount();
		await description();
		expect(screen.queryByRole("button", { name: "Delete draft" })).toBeNull();
	});
});

/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reportActions = vi.hoisted(() => ({
	getMyTravelExpenseReport: vi.fn(),
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

const reportId = "6a010000-0000-4000-8000-000000000001";
const trainId = "6a010000-0000-4000-8000-000000000002";
const hotelId = "6a010000-0000-4000-8000-000000000003";
const newId = "6a010000-0000-4000-8000-000000000004";

function item(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		type: "receipt",
		version: 1,
		updatedAt: "2026-10-05T10:00:00.000Z",
		expenseDate: null,
		category: null,
		description: null,
		amount: null,
		currency: "EUR",
		paidBy: null,
		accountingReference: null,
		receipts: [] as unknown[],
		...overrides,
	};
}

const train = item(trainId, {
	version: 2,
	expenseDate: "2026-09-14",
	category: "transport",
	description: "Train to Hamburg",
	amount: "89.90",
	paidBy: "employee",
	receipts: [
		{
			id: "6a010000-0000-4000-8000-000000000009",
			fileName: "ticket.pdf",
			mimeType: "application/pdf",
			sizeBytes: 4,
			createdAt: "2026-10-05T10:05:00.000Z",
		},
	],
});
const hotel = item(hotelId, {
	version: 4,
	expenseDate: "2026-09-15",
	category: "accommodation",
	description: "Hotel Hamburg",
	amount: "240.00",
	paidBy: "company",
});

const tripDetails = {
	version: 5,
	purpose: "Customer workshop",
	startDate: "2026-09-14",
	endDate: "2026-09-16",
	timeZone: "Europe/Berlin",
	destinations: [{ place: "Hamburg", countryCode: "DE" }],
};

function trip(overrides: { trip?: Record<string, unknown>; items?: unknown[] } = {}) {
	return {
		success: true,
		data: {
			id: reportId,
			kind: "trip",
			status: "draft",
			reimbursementCurrency: "EUR",
			createdAt: "2026-10-05T09:00:00.000Z",
			updatedAt: "2026-10-05T10:00:00.000Z",
			trip: { ...tripDetails, ...overrides.trip },
			items: overrides.items ?? [train, hotel],
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

async function purpose() {
	return (await screen.findByRole("textbox", { name: "Purpose of the trip" })) as HTMLInputElement;
}

function tripSection() {
	return screen.getByRole("region", { name: "Trip details" });
}

const originalTimeZone = process.env.TZ;

beforeEach(() => {
	reportActions.getMyTravelExpenseReport.mockResolvedValue(trip());
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	process.env.TZ = originalTimeZone;
});

describe("trip report editor", () => {
	it("restores shared trip details once and every expense with its own facts", async () => {
		mount();
		expect((await purpose()).value).toBe("Customer workshop");
		expect(within(tripSection()).getByRole("textbox", { name: "Place 1" })).toHaveProperty(
			"value",
			"Hamburg",
		);
		const expenses = screen.getAllByRole("region", { name: /^Expense \d/ });
		expect(expenses).toHaveLength(2);
		expect(within(expenses[0]!).getByRole("textbox", { name: "Description" })).toHaveProperty(
			"value",
			"Train to Hamburg",
		);
		expect(within(expenses[1]!).getByRole("textbox", { name: "Description" })).toHaveProperty(
			"value",
			"Hotel Hamburg",
		);
		// Shared travel details are not repeated per expense.
		expect(screen.getAllByRole("textbox", { name: "Purpose of the trip" })).toHaveLength(1);
	});

	it("totals employee-paid receipts as reimbursable and keeps company-paid ones separate", async () => {
		mount();
		await purpose();
		const totals = screen.getByRole("region", { name: "Totals" });
		expect(within(totals).getByText("Reimbursed to you").nextElementSibling?.textContent).toBe(
			"€89.90",
		);
		expect(within(totals).getByText("Paid by the company").nextElementSibling?.textContent).toBe(
			"€240.00",
		);
	});

	it("lists missing trip facts and links to each incomplete expense", async () => {
		reportActions.getMyTravelExpenseReport.mockResolvedValue(
			trip({ trip: { purpose: null, destinations: [] } }),
		);
		mount();
		await purpose();
		const needed = screen.getByRole("region", { name: "Still needed for this trip" });
		expect(within(needed).getByText("Describe the purpose of the trip.")).toBeTruthy();
		expect(within(needed).getByText("Add at least one destination.")).toBeTruthy();
		const link = within(needed).getByRole("link", { name: /Expense 2: Hotel Hamburg/ });
		expect(link.getAttribute("href")).toBe(`#expense-${hotelId}`);
		expect(within(needed).queryByRole("link", { name: /Expense 1/ })).toBeNull();
	});

	it.each([
		["Pacific/Kiritimati", "UTC+14"],
		["Pacific/Pago_Pago", "UTC-11"],
	])("shows the travel dates as entered for a viewer in %s (%s)", async (zone) => {
		process.env.TZ = zone;
		mount();
		await purpose();
		const section = tripSection();
		expect(within(section).getByText("Sep 14, 2026 – Sep 16, 2026")).toBeTruthy();
		expect(
			within(section).getByText("Travel dates are calendar days in Europe/Berlin.", {
				exact: false,
			}),
		).toBeTruthy();
	});

	it("autosaves trip details on the loaded version and keeps them after a failed save", async () => {
		reportActions.saveTripDetailsDraftAction
			.mockResolvedValueOnce({ success: false, error: "Failed to save trip details" })
			.mockResolvedValueOnce({
				success: true,
				data: { status: "saved", details: { ...tripDetails, version: 6, purpose: "Fair" } },
			});
		mount();
		fireEvent.change(await purpose(), { target: { value: "Fair" } });
		expect(
			await within(tripSection()).findByText(
				"Your changes could not be saved",
				{},
				{ timeout: 2000 },
			),
		).toBeTruthy();
		expect(reportActions.saveTripDetailsDraftAction).toHaveBeenCalledWith({
			reportId,
			expectedVersion: 5,
			values: {
				purpose: "Fair",
				startDate: "2026-09-14",
				endDate: "2026-09-16",
				timeZone: "Europe/Berlin",
				destinations: [{ place: "Hamburg", countryCode: "DE" }],
			},
		});
		expect((await purpose()).value).toBe("Fair");

		fireEvent.click(within(tripSection()).getByRole("button", { name: "Try again" }));
		await waitFor(() =>
			expect(within(tripSection()).getByRole("status").textContent).toBe("All changes saved"),
		);
		expect(reportActions.saveTripDetailsDraftAction).toHaveBeenCalledTimes(2);
	});

	it("does not overwrite trip details changed elsewhere and can load them", async () => {
		reportActions.saveTripDetailsDraftAction.mockResolvedValueOnce({
			success: true,
			data: {
				status: "conflict",
				details: { ...tripDetails, version: 8, purpose: "Edited on phone" },
			},
		});
		mount();
		fireEvent.change(await purpose(), { target: { value: "Edited on laptop" } });
		fireEvent.click(
			await within(tripSection()).findByRole(
				"button",
				{ name: "Load the saved version" },
				{ timeout: 2000 },
			),
		);
		expect((await purpose()).value).toBe("Edited on phone");
		expect(reportActions.saveTripDetailsDraftAction).toHaveBeenCalledTimes(1);
	});

	it("adds destinations and saves them with the trip", async () => {
		reportActions.saveTripDetailsDraftAction.mockResolvedValue({
			success: true,
			data: { status: "saved", details: { ...tripDetails, version: 6 } },
		});
		mount();
		await purpose();
		fireEvent.click(within(tripSection()).getByRole("button", { name: "Add destination" }));
		const place = within(tripSection()).getByRole("textbox", { name: "Place 2" });
		expect(document.activeElement).toBe(place);
		fireEvent.change(place, { target: { value: "Vienna" } });
		await waitFor(
			() =>
				expect(reportActions.saveTripDetailsDraftAction).toHaveBeenCalledWith(
					expect.objectContaining({
						values: expect.objectContaining({
							destinations: [
								{ place: "Hamburg", countryCode: "DE" },
								{ place: "Vienna", countryCode: null },
							],
						}),
					}),
				),
			{ timeout: 2000 },
		);
	});

	it("adds a receipt expense and moves focus to it", async () => {
		reportActions.addTripReportItemAction.mockResolvedValueOnce({
			success: true,
			data: { item: item(newId) },
		});
		mount();
		await purpose();
		reportActions.getMyTravelExpenseReport.mockResolvedValue(
			trip({ items: [train, hotel, item(newId)] }),
		);
		fireEvent.click(screen.getByRole("button", { name: "Add receipt expense" }));
		const added = await screen.findByRole("heading", { name: "Expense 3" });
		await waitFor(() => expect(document.activeElement).toBe(added));
		expect(reportActions.addTripReportItemAction).toHaveBeenCalledWith({ reportId });
		// Earlier expenses keep what was entered.
		expect(screen.getAllByRole("region", { name: /^Expense \d/ })).toHaveLength(3);
	});

	it("removes an expense after confirmation and returns focus to the add action", async () => {
		reportActions.removeTripReportItemAction.mockResolvedValueOnce({
			success: true,
			data: { status: "removed", itemId: trainId },
		});
		mount();
		await purpose();
		reportActions.getMyTravelExpenseReport.mockResolvedValue(trip({ items: [hotel] }));
		fireEvent.click(screen.getByRole("button", { name: "Remove expense 1" }));
		const dialog = await screen.findByRole("alertdialog");
		fireEvent.click(within(dialog).getByRole("button", { name: "Remove expense" }));

		await waitFor(() =>
			expect(screen.getAllByRole("region", { name: /^Expense \d/ })).toHaveLength(1),
		);
		expect(reportActions.removeTripReportItemAction).toHaveBeenCalledWith({
			reportId,
			itemId: trainId,
			expectedVersion: 2,
		});
		await waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByRole("button", { name: "Add receipt expense" }),
			),
		);
		expect(screen.queryByText(/could not be saved/)).toBeNull();
	});

	it("keeps an expense that changed elsewhere instead of removing it", async () => {
		reportActions.removeTripReportItemAction.mockResolvedValueOnce({
			success: true,
			data: { status: "conflict", item: { ...train, version: 3 } },
		});
		mount();
		await purpose();
		fireEvent.click(screen.getByRole("button", { name: "Remove expense 1" }));
		const dialog = await screen.findByRole("alertdialog");
		await act(async () => {
			fireEvent.click(within(dialog).getByRole("button", { name: "Remove expense" }));
		});
		expect(
			await screen.findByText(
				"This expense changed elsewhere and was not removed. Check it and try again.",
			),
		).toBeTruthy();
		expect(screen.getAllByRole("region", { name: /^Expense \d/ })).toHaveLength(2);
	});
});

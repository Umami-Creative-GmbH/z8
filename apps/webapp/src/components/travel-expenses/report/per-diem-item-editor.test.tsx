/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	calculatePerDiem,
	type PerDiemCalculation,
	type PerDiemItinerary,
	perDiemItemView,
	perDiemPolicyResolver,
	tripDays,
} from "@/lib/travel-expenses/per-diem";
import { GERMAN_DOMESTIC_PER_DIEM_DEFAULT } from "@/lib/travel-expenses/statutory-per-diem-defaults";

const reportActions = vi.hoisted(() => ({
	getMyTravelExpenseReport: vi.fn(),
	saveReceiptItemDraftAction: vi.fn(),
	removeReportReceiptAction: vi.fn(),
	saveTripDetailsDraftAction: vi.fn(),
	addTripReportItemAction: vi.fn(),
	removeTripReportItemAction: vi.fn(),
}));
const perDiemActions = vi.hoisted(() => ({
	savePerDiemDraftAction: vi.fn(),
	addTripPerDiemItemAction: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/report-actions", () => reportActions);
vi.mock("@/app/[locale]/(app)/travel-expenses/per-diem-actions", () => perDiemActions);
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
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
vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

import { TravelExpenseReportEditor } from "./travel-expense-report-editor";

const reportId = "6a090000-0000-4000-8000-000000000001";
const itemId = "6a090000-0000-4000-8000-000000000002";

const itinerary: PerDiemItinerary = {
	startDate: "2026-09-14",
	startTime: "07:00",
	startTimeZone: "Europe/Berlin",
	endDate: "2026-09-15",
	endTime: "18:00",
	endTimeZone: "Europe/Berlin",
	overnight: "away",
	prolongedWorkplace: false,
	meals: tripDays("2026-09-14", "2026-09-15").map((date) => ({
		date,
		breakfast: { provided: date === "2026-09-15", employeePayment: null },
		lunch: { provided: false, employeePayment: null },
		dinner: { provided: false, employeePayment: null },
	})),
};

const calculated = calculatePerDiem(itinerary, {
	trip: { destinations: [{ place: "Hamburg", countryCode: "DE" }] },
	reimbursementCurrency: "EUR",
	resolvePolicy: perDiemPolicyResolver([
		{
			id: "6a090000-0000-4000-8000-0000000000a1",
			policyId: "6a090000-0000-4000-8000-0000000000a2",
			effectiveFrom: "2026-01-01",
			currency: "EUR",
			source: {
				kind: "statutory_default",
				reference: GERMAN_DOMESTIC_PER_DIEM_DEFAULT.reference,
				version: GERMAN_DOMESTIC_PER_DIEM_DEFAULT.version,
				defaultKey: GERMAN_DOMESTIC_PER_DIEM_DEFAULT.key,
			},
			withdrawnAt: null,
			rates: { DE: { ...GERMAN_DOMESTIC_PER_DIEM_DEFAULT.rates } },
		},
	]),
});

function perDiemItem(calculation: PerDiemCalculation, overrides: Record<string, unknown> = {}) {
	return {
		id: itemId,
		type: "per_diem",
		version: 3,
		updatedAt: "2026-10-05T10:00:00.000Z",
		expenseDate: "2026-09-14",
		category: null,
		description: null,
		amount: null,
		currency: null,
		paidBy: "employee",
		accountingReference: null,
		receiptException: { reason: null, version: 0 },
		receipts: [],
		mileage: null,
		perDiem: perDiemItemView(itinerary, calculation),
		...overrides,
	};
}

function trip(item: unknown) {
	return {
		success: true,
		data: {
			id: reportId,
			kind: "trip",
			status: "draft",
			submissionCount: 0,
			reimbursementCurrency: "EUR",
			createdAt: "2026-10-05T09:00:00.000Z",
			updatedAt: "2026-10-05T10:00:00.000Z",
			trip: {
				version: 2,
				purpose: "Customer workshop",
				startDate: "2026-09-14",
				endDate: "2026-09-15",
				timeZone: "Europe/Berlin",
				destinations: [{ place: "Hamburg", countryCode: "DE" }],
			},
			items: [item],
			receiptExceptionsAllowed: false,
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

beforeEach(() => {
	reportActions.getMyTravelExpenseReport.mockResolvedValue(trip(perDiemItem(calculated)));
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("per diem (#609)", () => {
	it("shows the server's daily breakdown with meal deductions and counts it", async () => {
		mount();
		const panel = await screen.findByRole("region", { name: "Calculated per diem" });
		const rows = within(panel).getAllByRole("row");
		// Header, two travel days, total.
		expect(rows).toHaveLength(4);
		expect(within(rows[1] as HTMLElement).getByRole("rowheader").textContent).toBe("Sep 14, 2026");
		expect(rows[2]?.textContent).toContain("Breakfast: −€5.60");
		expect(rows[2]?.textContent).toContain("€8.40");
		expect(rows[3]?.textContent).toContain("€22.40");
		const totals = screen.getByRole("region", { name: "Totals" });
		expect(within(totals).getByText("Reimbursed to you").nextElementSibling?.textContent).toBe(
			"€22.40",
		);
		expect(screen.queryByRole("button", { name: "Add per diem" })).toBeNull();
	});

	it("flags an exceptional itinerary instead of calculating it, and blocks submission", async () => {
		reportActions.getMyTravelExpenseReport.mockResolvedValue(
			trip(
				perDiemItem({
					status: "exceptional",
					reasons: ["overlapping_days"],
					overlappingDays: ["2026-09-15"],
				}),
			),
		);
		mount();
		expect(await screen.findByText("Needs a manual calculation")).toBeTruthy();
		expect(screen.getByText(/Another of your reports already claims per diem/)).toBeTruthy();
		expect(screen.getByText(/Sep 15, 2026/, { selector: "li" })).toBeTruthy();
		expect(
			(screen.getByRole("button", { name: "Review and submit" }) as HTMLButtonElement).disabled,
		).toBe(true);
	});

	it("saves only the itinerary and meals, never an amount", async () => {
		perDiemActions.savePerDiemDraftAction.mockResolvedValue({
			success: true,
			data: { status: "saved", item: perDiemItem(calculated, { version: 4 }) },
		});
		mount();
		await screen.findByRole("region", { name: "Calculated per diem" });
		const lunch = screen.getAllByRole("checkbox", { name: "Lunch" })[0] as HTMLElement;
		fireEvent.click(lunch);
		await waitFor(() => expect(perDiemActions.savePerDiemDraftAction).toHaveBeenCalled(), {
			timeout: 3000,
		});
		const [call] = perDiemActions.savePerDiemDraftAction.mock.calls[0] as [
			{ values: Record<string, unknown> },
		];
		expect(Object.keys(call.values).toSorted()).toEqual([
			"endDate",
			"endTime",
			"endTimeZone",
			"meals",
			"overnight",
			"prolongedWorkplace",
			"startDate",
			"startTime",
			"startTimeZone",
		]);
		expect((call.values.meals as { lunch: { provided: boolean } }[])[0]?.lunch.provided).toBe(true);
	});

	it("offers one per diem on a trip without one", async () => {
		reportActions.getMyTravelExpenseReport.mockResolvedValue({
			...trip(perDiemItem(calculated)),
			data: { ...trip(perDiemItem(calculated)).data, items: [] },
		});
		mount();
		expect(await screen.findByRole("button", { name: "Add per diem" })).toBeTruthy();
	});
});

/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	ExpenseHistoryRow,
	LegacyClaimHistoryRow,
	ReportHistoryRow,
} from "@/lib/travel-expenses/expense-history";
import type { SettlementSummary } from "@/lib/travel-expenses/settlement";

const historyActions = vi.hoisted(() => ({
	getMyTravelExpenseHistory: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/history-actions", () => historyActions);
const reportActions = vi.hoisted(() => ({
	createStandaloneReceiptReportAction: vi.fn(),
	createTripReportAction: vi.fn(),
	deleteDraftTravelExpenseReportAction: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/[locale]/(app)/travel-expenses/report-actions", () => reportActions);
vi.mock("@/app/[locale]/(app)/travel-expenses/mileage-actions", () => ({
	createStandaloneMileageReportAction: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/legacy-draft-actions", () => ({
	convertLegacyTravelExpenseDraftAction: vi.fn(),
	getLegacyTravelExpenseConversion: vi.fn(),
}));
const router = vi.hoisted(() => ({ push: vi.fn() }));
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
vi.mock("next-intl", () => ({
	useLocale: () => "en-US",
	useTranslations: () => (_key: string) => _key,
}));
vi.mock("@/navigation", () => ({
	Link: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
	useRouter: () => router,
}));

import { TravelExpenseManagement } from "./travel-expense-management";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function reportRow(overrides: Partial<ReportHistoryRow> & { id: string }): ReportHistoryRow {
	return {
		source: "report",
		href: `/travel-expenses/reports/${overrides.id}`,
		stage: "needs_action",
		activityAt: "2026-10-05T10:00:00.000Z",
		balance: null,
		reimbursement: null,
		dates: { start: "2026-09-14", end: "2026-09-14" },
		kind: "standalone",
		status: "draft",
		itemType: "receipt",
		title: "Hotel Hamburg",
		itemCount: 1,
		receiptCount: 1,
		totals: { currency: "EUR", reimbursable: "129.90", companyPaid: "0.00", excludedItemCount: 0 },
		adjustmentOf: null,
		continuedFromClaimId: null,
		deletable: false,
		...overrides,
	};
}

function claimRow(overrides: Partial<LegacyClaimHistoryRow> = {}): LegacyClaimHistoryRow {
	return {
		source: "legacy_claim",
		id: "old-claim",
		href: "/travel-expenses/old-claim",
		stage: "approved",
		activityAt: "2026-04-01T10:00:00.000Z",
		balance: null,
		reimbursement: null,
		dates: { start: "2026-03-29", end: "2026-03-31" },
		claimType: "receipt",
		status: "approved",
		amount: { amount: "120.50", currency: "EUR" },
		destination: "Berlin",
		canContinue: false,
		...overrides,
	};
}

const outstandingBalance: SettlementSummary = {
	state: "outstanding",
	currencies: [
		{
			currency: "EUR",
			entitlement: "89.90",
			reimbursed: "50.00",
			recovered: "0.00",
			balance: "39.90",
			state: "outstanding",
		},
	],
};

const reimbursedBalance: SettlementSummary = {
	state: "settled",
	currencies: [
		{
			currency: "EUR",
			entitlement: "89.90",
			reimbursed: "89.90",
			recovered: "0.00",
			balance: "0.00",
			state: "settled",
		},
	],
};

function respond(rows: ExpenseHistoryRow[]) {
	return { success: true, data: rows };
}

function mount() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<TravelExpenseManagement organizationId="org" employeeId="owner" />
		</QueryClientProvider>,
	);
	return client;
}

describe("creating reports", () => {
	it("creates a standalone receipt report and opens its editor", async () => {
		historyActions.getMyTravelExpenseHistory.mockResolvedValue(respond([]));
		reportActions.createStandaloneReceiptReportAction.mockResolvedValueOnce({
			success: true,
			data: { reportId: "report-2" },
		});
		const client = mount();
		fireEvent.click(screen.getByRole("button", { name: "New receipt" }));
		await vi.waitFor(() =>
			expect(router.push).toHaveBeenCalledWith("/travel-expenses/reports/report-2"),
		);
		client.clear();
	});

	it("creates a trip report and opens its editor", async () => {
		historyActions.getMyTravelExpenseHistory.mockResolvedValue(respond([]));
		reportActions.createTripReportAction.mockResolvedValueOnce({
			success: true,
			data: { reportId: "trip-1" },
		});
		const client = mount();
		fireEvent.click(screen.getByRole("button", { name: "New trip" }));
		await vi.waitFor(() =>
			expect(router.push).toHaveBeenCalledWith("/travel-expenses/reports/trip-1"),
		);
		client.clear();
	});

	it("guides a first-time user with an empty state instead of an empty table", async () => {
		historyActions.getMyTravelExpenseHistory.mockResolvedValue(respond([]));
		const client = mount();
		expect(await screen.findByText("No travel expenses yet")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "New Claim" })).toBeNull();
		client.clear();
	});
});

describe("unified history", () => {
	it("lists drafts, decided reports and earlier claims in one list", async () => {
		historyActions.getMyTravelExpenseHistory.mockResolvedValue(
			respond([
				reportRow({
					id: "trip-2",
					kind: "trip",
					itemType: null,
					title: "Customer workshop",
					dates: { start: "2026-09-14", end: "2026-09-16" },
					itemCount: 3,
					totals: {
						currency: "EUR",
						reimbursable: "102.00",
						companyPaid: "240.00",
						excludedItemCount: 0,
					},
				}),
				claimRow(),
			]),
		);
		const client = mount();
		const trip = await screen.findByRole("link", { name: /Customer workshop/ });
		expect(trip.getAttribute("href")).toBe("/travel-expenses/reports/trip-2");
		const tripRow = trip.closest("li") as HTMLElement;
		expect(tripRow.textContent).toContain("Sep 14, 2026 – Sep 16, 2026");
		expect(tripRow.textContent).toContain("3 expenses");
		expect(tripRow.textContent).toContain("€102.00");
		expect(tripRow.textContent).toContain("Company-paid €240.00");
		const claim = screen.getByRole("link", { name: /Receipt claim/ });
		expect(claim.getAttribute("href")).toBe("/travel-expenses/old-claim");
		const legacyRow = claim.closest("li") as HTMLElement;
		expect(legacyRow.textContent).toContain("Earlier claim");
		expect(legacyRow.textContent).toContain("€120.50");
		expect(legacyRow.textContent).toContain("Mar 29, 2026 – Mar 31, 2026");
		client.clear();
	});

	it("labels an adjustment with a link to the report it corrects", async () => {
		historyActions.getMyTravelExpenseHistory.mockResolvedValue(
			respond([
				reportRow({
					id: "adjustment",
					stage: "in_review",
					status: "submitted",
					kind: "trip",
					title: "Customer workshop",
					adjustmentOf: { reportId: "original", title: "Customer workshop", kind: "trip" },
				}),
			]),
		);
		const client = mount();
		const original = await screen.findByRole("link", {
			name: "Adjustment of “Customer workshop”",
		});
		expect(original.getAttribute("href")).toBe("/travel-expenses/reports/original");
		client.clear();
	});

	it("shows the settlement balance of approved expenses, including an overpayment", async () => {
		historyActions.getMyTravelExpenseHistory.mockResolvedValue(
			respond([
				reportRow({
					id: "approved",
					stage: "approved",
					status: "approved",
					balance: {
						state: "overpaid",
						currencies: [
							{
								currency: "EUR",
								entitlement: "450.00",
								reimbursed: "500.00",
								recovered: "0.00",
								balance: "-50.00",
								state: "overpaid",
							},
						],
					},
				}),
			]),
		);
		const client = mount();
		expect(await screen.findByText("€50.00 overpaid")).toBeTruthy();
		client.clear();
	});

	it("shows Reimbursed instead of Approved on a fully reimbursed expense (#751)", async () => {
		historyActions.getMyTravelExpenseHistory.mockResolvedValue(
			respond([
				reportRow({
					id: "reimbursed",
					title: "Reimbursed receipt",
					stage: "approved",
					status: "approved",
					balance: reimbursedBalance,
					reimbursement: "reimbursed",
				}),
				reportRow({
					id: "awaiting",
					title: "Awaiting receipt",
					stage: "approved",
					status: "approved",
					balance: outstandingBalance,
					reimbursement: "awaiting",
				}),
				claimRow({ balance: reimbursedBalance, reimbursement: "reimbursed" }),
			]),
		);
		const client = mount();
		const reimbursed = (await screen.findByText("Reimbursed receipt")).closest("li") as HTMLElement;
		expect(within(reimbursed).getByText("Reimbursed")).toBeTruthy();
		expect(within(reimbursed).queryByText("Approved")).toBeNull();
		const legacy = screen.getByText(/Receipt claim/).closest("li") as HTMLElement;
		expect(within(legacy).getByText("Reimbursed")).toBeTruthy();
		const awaiting = screen.getByText("Awaiting receipt").closest("li") as HTMLElement;
		expect(within(awaiting).getByText("Approved")).toBeTruthy();
		expect(within(awaiting).getByText("€39.90 outstanding")).toBeTruthy();
		expect(within(awaiting).queryByText("Reimbursed")).toBeNull();
		expect(screen.queryByText(/settled/i)).toBeNull();
		client.clear();
	});

	it("offers to continue a legacy draft as a report", async () => {
		historyActions.getMyTravelExpenseHistory.mockResolvedValue(
			respond([claimRow({ status: "draft", stage: "needs_action", canContinue: true })]),
		);
		const client = mount();
		expect(await screen.findByRole("button", { name: "Continue as report" })).toBeTruthy();
		client.clear();
	});

	it("deletes a never-submitted draft from its row after confirmation (#684)", async () => {
		historyActions.getMyTravelExpenseHistory
			.mockResolvedValueOnce(
				respond([
					reportRow({ id: "draft", title: "Draft receipt", deletable: true }),
					reportRow({ id: "withdrawn", title: "Withdrawn receipt" }),
				]),
			)
			.mockResolvedValue(respond([reportRow({ id: "withdrawn", title: "Withdrawn receipt" })]));
		reportActions.deleteDraftTravelExpenseReportAction.mockResolvedValueOnce({
			success: true,
			data: { reportId: "draft" },
		});
		const client = mount();
		await screen.findByText("Draft receipt");
		expect(screen.queryByRole("button", { name: "Delete draft “Withdrawn receipt”" })).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Delete draft “Draft receipt”" }));
		const dialog = await screen.findByRole("alertdialog");
		expect(dialog.textContent).toContain("Delete this draft?");
		expect(reportActions.deleteDraftTravelExpenseReportAction).not.toHaveBeenCalled();
		fireEvent.click(within(dialog).getByRole("button", { name: "Delete draft" }));

		await vi.waitFor(() => expect(screen.queryByText("Draft receipt")).toBeNull());
		expect(reportActions.deleteDraftTravelExpenseReportAction).toHaveBeenCalledWith({
			reportId: "draft",
		});
		expect(screen.getByText("Withdrawn receipt")).toBeTruthy();
		client.clear();
	});

	it("warns that deleting a continued draft deletes the earlier claim too", async () => {
		historyActions.getMyTravelExpenseHistory.mockResolvedValue(
			respond([
				reportRow({
					id: "continued",
					title: "Taxi",
					deletable: true,
					continuedFromClaimId: "old-draft",
				}),
			]),
		);
		const client = mount();
		fireEvent.click(await screen.findByRole("button", { name: "Delete draft “Taxi”" }));
		const dialog = await screen.findByRole("alertdialog");
		expect(dialog.textContent).toContain("together with the earlier claim draft it continues");
		client.clear();
	});
});

describe("status filters", () => {
	const rows = [
		reportRow({ id: "draft", title: "Draft receipt" }),
		reportRow({
			id: "pending",
			title: "Pending receipt",
			stage: "in_review",
			status: "submitted",
		}),
		reportRow({
			id: "rejected",
			title: "Rejected receipt",
			stage: "rejected",
			status: "rejected",
		}),
		claimRow(),
	];

	it("filters by review status with counts", async () => {
		historyActions.getMyTravelExpenseHistory.mockResolvedValue(respond(rows));
		const client = mount();
		await screen.findByText("Draft receipt");
		const filters = screen.getByRole("radiogroup", { name: "Show expenses" });
		fireEvent.click(within(filters).getByRole("radio", { name: /In review/ }));
		expect(screen.getByText("Pending receipt")).toBeTruthy();
		expect(screen.queryByText("Draft receipt")).toBeNull();
		expect(screen.queryByText(/Receipt claim/)).toBeNull();
		expect(within(filters).getByRole("radio", { name: /Approved/ }).textContent).toContain("1");
		client.clear();
	});

	it("filters to expenses awaiting reimbursement (#751)", async () => {
		historyActions.getMyTravelExpenseHistory.mockResolvedValue(
			respond([
				...rows,
				reportRow({
					id: "awaiting",
					title: "Awaiting receipt",
					stage: "approved",
					status: "approved",
					balance: outstandingBalance,
					reimbursement: "awaiting",
				}),
				reportRow({
					id: "reimbursed",
					title: "Reimbursed receipt",
					stage: "approved",
					status: "approved",
					balance: reimbursedBalance,
					reimbursement: "reimbursed",
				}),
			]),
		);
		const client = mount();
		await screen.findByText("Draft receipt");
		const filters = screen.getByRole("radiogroup", { name: "Show expenses" });
		const labels = within(filters)
			.getAllByRole("radio")
			.map((radio) => radio.textContent?.replace(/\d+$/, ""));
		expect(labels).toEqual([
			"All",
			"To finish",
			"In review",
			"Approved",
			"Awaiting reimbursement",
			"Rejected",
		]);
		const awaiting = within(filters).getByRole("radio", { name: /Awaiting reimbursement/ });
		expect(awaiting.textContent).toContain("1");
		fireEvent.click(awaiting);
		expect(screen.getByText("Awaiting receipt")).toBeTruthy();
		expect(screen.queryByText("Reimbursed receipt")).toBeNull();
		expect(screen.queryByText("Draft receipt")).toBeNull();
		expect(screen.queryByText(/Receipt claim/)).toBeNull();
		client.clear();
	});

	it("explains an empty filter and offers to show everything", async () => {
		historyActions.getMyTravelExpenseHistory.mockResolvedValue(respond([rows[0]]));
		const client = mount();
		await screen.findByText("Draft receipt");
		fireEvent.click(screen.getByRole("radio", { name: /Rejected/ }));
		expect(screen.getByText("No expenses with this status.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Show all expenses" }));
		expect(screen.getByText("Draft receipt")).toBeTruthy();
		client.clear();
	});
});

describe("travel history recovery", () => {
	it("preserves loaded rows during a background refresh", async () => {
		historyActions.getMyTravelExpenseHistory
			.mockResolvedValueOnce(respond([claimRow()]))
			.mockImplementationOnce(() => new Promise(() => {}));
		const client = mount();
		await screen.findByText("€120.50");
		await act(async () => {
			void client.invalidateQueries({ queryKey: ["travel-expenses", "history"] });
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		expect(screen.getByText("€120.50")).toBeTruthy();
		expect(screen.getByText("Refreshing…")).toBeTruthy();
		client.clear();
	});

	it("shows retry guidance on initial failure and recovers without an empty-history message", async () => {
		historyActions.getMyTravelExpenseHistory
			.mockResolvedValueOnce({ success: false, error: "Load failed" })
			.mockResolvedValueOnce(respond([claimRow()]));
		const client = mount();
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(screen.queryByText("No travel expenses yet")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(await screen.findByText("€120.50")).toBeTruthy();
		client.clear();
	});

	it("keeps loaded rows and shows retry when a background refresh fails", async () => {
		historyActions.getMyTravelExpenseHistory
			.mockResolvedValueOnce(respond([claimRow()]))
			.mockResolvedValueOnce({ success: false, error: "Load failed" });
		const client = mount();
		await screen.findByText("€120.50");
		await act(async () => {
			await client.invalidateQueries({ queryKey: ["travel-expenses", "history"] });
		});
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(screen.getByText("€120.50")).toBeTruthy();
		expect(screen.queryByText("No travel expenses yet")).toBeNull();
		client.clear();
	});
});

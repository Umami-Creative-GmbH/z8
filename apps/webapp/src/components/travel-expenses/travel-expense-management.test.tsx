/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
	getMyTravelExpenseClaims: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/actions", () => actions);
const reportActions = vi.hoisted(() => ({
	getMyDraftTravelExpenseReports: vi.fn(async () => ({ success: true, data: [] as unknown[] })),
	createStandaloneReceiptReportAction: vi.fn(),
	createTripReportAction: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/report-actions", () => reportActions);
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

import { TravelExpenseManagement } from "./travel-expense-management";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});
const claim = {
	id: "old-claim",
	type: "receipt",
	status: "approved",
	calculatedAmount: "120.50",
	calculatedCurrency: "EUR",
	tripStartDate: "2026-03-29",
	tripEndDate: "2026-03-31",
};
function mount() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<TravelExpenseManagement organizationId="org" employeeId="owner" />
		</QueryClientProvider>,
	);
	return client;
}
describe("standalone receipt reports", () => {
	it("lists saved drafts so they can be resumed", async () => {
		actions.getMyTravelExpenseClaims.mockResolvedValue({ success: true, data: [] });
		reportActions.getMyDraftTravelExpenseReports.mockResolvedValueOnce({
			success: true,
			data: [
				{
					id: "report-1",
					kind: "standalone",
					updatedAt: "2026-10-05T10:00:00.000Z",
					expenseDate: "2026-09-14",
					description: "Hotel Hamburg",
					amount: "129.90",
					currency: "EUR",
					receiptCount: 1,
				},
			],
		});
		const client = mount();
		const link = await screen.findByRole("link", { name: /Hotel Hamburg/ });
		expect(link.getAttribute("href")).toBe("/travel-expenses/reports/report-1");
		client.clear();
	});

	it("creates a standalone receipt report and opens its editor", async () => {
		actions.getMyTravelExpenseClaims.mockResolvedValue({ success: true, data: [] });
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
});

describe("trip reports", () => {
	it("creates a trip report and opens its editor", async () => {
		actions.getMyTravelExpenseClaims.mockResolvedValue({ success: true, data: [] });
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

	it("offers only usable expense types, not manual mileage or per-diem claims", async () => {
		actions.getMyTravelExpenseClaims.mockResolvedValue({ success: true, data: [] });
		const client = mount();
		expect(screen.queryByRole("button", { name: "New Claim" })).toBeNull();
		expect(screen.queryByText("Mileage")).toBeNull();
		expect(screen.queryByText("Per Diem")).toBeNull();
		client.clear();
	});

	it("lists trip drafts with purpose, travel dates, expense count and reimbursable total", async () => {
		actions.getMyTravelExpenseClaims.mockResolvedValue({ success: true, data: [] });
		reportActions.getMyDraftTravelExpenseReports.mockResolvedValueOnce({
			success: true,
			data: [
				{
					id: "trip-2",
					kind: "trip",
					updatedAt: "2026-10-05T10:00:00.000Z",
					expenseDate: "2026-09-14",
					description: "Train to Hamburg",
					amount: "89.90",
					currency: "EUR",
					receiptCount: 1,
					trip: {
						purpose: "Customer workshop",
						startDate: "2026-09-14",
						endDate: "2026-09-16",
						itemCount: 3,
						reimbursable: "102.00",
						currency: "EUR",
					},
				},
			],
		});
		const client = mount();
		const link = await screen.findByRole("link", { name: /Customer workshop/ });
		expect(link.getAttribute("href")).toBe("/travel-expenses/reports/trip-2");
		expect(link.textContent).toContain("Sep 14, 2026 – Sep 16, 2026");
		expect(link.textContent).toContain("3 expenses");
		expect(link.textContent).toContain("€102.00");
		expect(link.textContent).not.toContain("Train to Hamburg");
		client.clear();
	});
});

describe("travel history recovery", () => {
	it("preserves loaded claims during a background refresh", async () => {
		actions.getMyTravelExpenseClaims
			.mockResolvedValueOnce({ success: true, data: [claim] })
			.mockImplementationOnce(() => new Promise(() => {}));
		const client = mount();
		await screen.findByText("120.50 EUR");
		await act(async () => {
			void client.invalidateQueries({ queryKey: ["travel-expenses", "list"] });
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		expect(screen.getByText("120.50 EUR")).toBeTruthy();
		client.clear();
	});
	it("shows retry guidance on initial failure and recovers without an empty-history message", async () => {
		actions.getMyTravelExpenseClaims
			.mockResolvedValueOnce({ success: false, error: "Load failed" })
			.mockResolvedValueOnce({ success: true, data: [claim] });
		const client = mount();
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(screen.queryByText("No travel expense claims yet")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(await screen.findByText("120.50 EUR")).toBeTruthy();
		client.clear();
	});
	it("preserves loaded rows and shows retry when background refresh fails", async () => {
		actions.getMyTravelExpenseClaims
			.mockResolvedValueOnce({ success: true, data: [claim] })
			.mockResolvedValueOnce({ success: false, error: "Load failed" });
		const client = mount();
		await screen.findByText("120.50 EUR");
		await act(async () => {
			await client.invalidateQueries({ queryKey: ["travel-expenses", "list"] });
		});
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(screen.getByText("120.50 EUR")).toBeTruthy();
		expect(screen.queryByText("No travel expense claims yet")).toBeNull();
		client.clear();
	});
});
vi.mock("@/navigation", () => ({
	Link: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
	useRouter: () => router,
}));

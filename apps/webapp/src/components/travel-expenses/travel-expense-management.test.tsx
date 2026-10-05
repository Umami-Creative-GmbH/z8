/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
	getMyTravelExpenseClaims: vi.fn(),
	createTravelExpenseDraft: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/actions", () => actions);
const reportActions = vi.hoisted(() => ({
	getMyDraftTravelExpenseReports: vi.fn(async () => ({ success: true, data: [] as unknown[] })),
	createStandaloneReceiptReportAction: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/report-actions", () => reportActions);
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
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
	Link: ({ children, ...props }: React.ComponentProps<"a">) => (
		<a {...props}>{children}</a>
	),
	useRouter: () => router,
}));

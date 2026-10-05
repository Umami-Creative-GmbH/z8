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
}));

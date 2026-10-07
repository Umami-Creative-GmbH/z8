/* @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TravelExpenseList } from "./travel-expense-list";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));
afterEach(cleanup);
const claim = {
	id: "old-claim",
	type: "receipt" as const,
	status: "approved",
	calculatedAmount: "120.50",
	calculatedCurrency: "EUR",
	tripStart: "2026-03-28T23:00:00Z",
	tripEnd: "2026-03-31T21:59:59Z",
	tripStartDate: "2026-03-29",
	tripEndDate: "2026-03-31",
	tripDateTimeZone: "Europe/Berlin",
};
describe("employee travel claim history", () => {
	it("shows the stored logical dates independently of the UTC bounds", () => {
		render(<TravelExpenseList claims={[claim]} />);
		expect(screen.getByText("Mar 29, 2026 – Mar 31, 2026")).toBeTruthy();
	});
	it("identifies unknown legacy dates instead of deriving a viewer date", () => {
		render(
			<TravelExpenseList
				claims={[{ ...claim, tripStartDate: null, tripEndDate: null }]}
			/>,
		);
		expect(
			screen.getByText("Trip date context not recorded (legacy claim)"),
		).toBeTruthy();
		expect(screen.queryByText(/Mar 28/)).toBeNull();
	});
	it("links each persisted claim to its own detail page", () => {
		render(<TravelExpenseList claims={[claim]} />);
		expect(
			screen.getByRole("link", { name: "View claim" }).getAttribute("href"),
		).toBe("/travel-expenses/old-claim");
	});
});
vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: vi.fn() }),
	Link: ({ children, ...props }: React.ComponentProps<"a">) => (
		<a {...props}>{children}</a>
	),
}));
describe("legacy drafts in the claim history (#616)", () => {
	const draft = { ...claim, status: "draft" };
	it("offers to continue an open draft as a report", () => {
		render(
			<QueryClientProvider client={new QueryClient()}>
				<TravelExpenseList claims={[draft]} />
			</QueryClientProvider>,
		);
		expect(screen.getByRole("button", { name: "Continue as report" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "View claim" })).toBeTruthy();
	});
	it("links a continued draft to its report instead", () => {
		render(<TravelExpenseList claims={[{ ...draft, convertedReportId: "report-1" }]} />);
		expect(screen.getByText("Continued as report")).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Open the report" }).getAttribute("href"),
		).toBe("/travel-expenses/reports/report-1");
		expect(screen.queryByRole("button", { name: "Continue as report" })).toBeNull();
	});
});
vi.mock("@/app/[locale]/(app)/travel-expenses/legacy-draft-actions", () => ({
	convertLegacyTravelExpenseDraftAction: vi.fn(),
	getLegacyTravelExpenseConversion: vi.fn(),
}));
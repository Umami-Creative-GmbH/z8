/* @vitest-environment jsdom */
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
	Link: ({ children, ...props }: React.ComponentProps<"a">) => (
		<a {...props}>{children}</a>
	),
}));

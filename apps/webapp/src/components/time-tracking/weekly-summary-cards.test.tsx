/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WeeklySummaryCards } from "./weekly-summary-cards";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const summary = {
	todayMinutes: 120,
	weekMinutes: 600,
	monthMinutes: 1800,
};

describe("WeeklySummaryCards", () => {
	it("renders all-time work balance as a fourth summary card", () => {
		render(
			<WeeklySummaryCards
				summary={summary}
				workBalance={{
					employeeId: "employee-1",
					organizationId: "org-1",
					actualMinutes: 2520,
					requiredMinutes: 2400,
					balanceMinutes: 120,
					computedFromDate: "2026-05-01",
					computedThroughDate: "2026-05-22",
					computedAt: new Date("2026-05-22T12:00:00.000Z"),
				}}
			/>,
		);

		expect(screen.getByText("All-time balance")).toBeTruthy();
		expect(screen.getByText("+2:00h")).toBeTruthy();
	});

	it("renders a missing-balance fallback", () => {
		render(<WeeklySummaryCards summary={summary} workBalance={null} />);

		expect(screen.getByText("Not calculated yet")).toBeTruthy();
	});
});

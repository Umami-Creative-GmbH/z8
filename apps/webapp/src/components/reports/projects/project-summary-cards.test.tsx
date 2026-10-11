/* @vitest-environment jsdom */

import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@/test/render-with-translations";

const display = vi.hoisted(() => ({ locale: "en-US" }));

vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({ locale: display.locale, timezone: "UTC", timeFormat: "24h" }),
}));

import { ProjectSummaryCards } from "./project-summary-cards";

const data = {
	totalProjects: 3,
	activeProjects: 2,
	totalHours: 1234.5,
	projectsOverBudget: 0,
	projectsOverdue: 0,
};

beforeEach(() => {
	display.locale = "en-US";
});

describe("ProjectSummaryCards", () => {
	it("shows total hours across projects in the viewer's locale", () => {
		display.locale = "de-DE";
		render(<ProjectSummaryCards data={data} />);

		expect(screen.getByText("1.234,5 h")).toBeTruthy();
	});

	it("shows a single project's hours, budget and daily average in the viewer's locale", () => {
		display.locale = "de-DE";
		render(
			<ProjectSummaryCards
				data={data}
				isSingleProject
				project={{} as never}
				summary={{
					totalHours: 12.25,
					uniqueEmployees: 2,
					workPeriodCount: 4,
					averageHoursPerDay: 3.5,
					budgetHours: 40,
					percentBudgetUsed: 30.6,
				}}
			/>,
		);

		expect(screen.getByText("12,3 h")).toBeTruthy();
		expect(screen.getByText("3,5 h")).toBeTruthy();
		expect(screen.getByText("12,3h of 40h")).toBeTruthy();
	});

	it("keeps English hours with a decimal point", () => {
		render(<ProjectSummaryCards data={data} />);

		expect(screen.getByText("1,234.5 h")).toBeTruthy();
	});
});

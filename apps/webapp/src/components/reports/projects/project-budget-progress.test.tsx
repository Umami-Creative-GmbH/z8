/* @vitest-environment jsdom */

import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@/test/render-with-translations";

vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({ locale: "de-DE", timezone: "UTC", timeFormat: "24h" }),
}));

import { ProjectBudgetProgress } from "./project-budget-progress";

describe("ProjectBudgetProgress", () => {
	it("shows used and remaining hours in the viewer's locale", () => {
		render(<ProjectBudgetProgress budgetHours={40} usedHours={12.5} />);

		expect(screen.getByText("12,5 h")).toBeTruthy();
		expect(screen.getByText("27,5 h")).toBeTruthy();
		expect(screen.getByText("12,5h used")).toBeTruthy();
		expect(screen.getByText("40,0h budget")).toBeTruthy();
		expect(screen.getByText("27,5 hours remaining in budget")).toBeTruthy();
	});

	it("shows hours over budget in the viewer's locale", () => {
		render(<ProjectBudgetProgress budgetHours={10} usedHours={12.5} />);

		expect(screen.getByText("2,5 h")).toBeTruthy();
		expect(screen.getByText("Exceeded budget by 2,5 hours")).toBeTruthy();
	});
});

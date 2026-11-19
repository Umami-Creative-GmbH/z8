/* @vitest-environment jsdom */

import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ProjectSummary } from "@/lib/reports/project-types";
import { render } from "@/test/render-with-translations";

vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({
		locale: "de-DE",
		timezone: "UTC",
		timeFormat: "24h",
	}),
}));

vi.mock("@/navigation", () => ({ Link: () => null }));

import { ProjectPortfolioTable } from "./project-portfolio-table";

const project = {
	id: "project-1",
	name: "Website",
	description: null,
	color: null,
	status: "active",
	customer: null,
	totalHours: 12.5,
	budgetHours: 40,
	percentBudgetUsed: 31,
	forecastSeverity: "none",
	deadline: null,
	daysUntilDeadline: null,
	billable: null,
} as unknown as ProjectSummary;

describe("ProjectPortfolioTable", () => {
	it("keeps every local result reachable and opens the correct project after filtering and paging", async () => {
		const user = userEvent.setup();
		const onSelect = vi.fn();
		const projects = Array.from({ length: 11 }, (_, index) => ({
			...project,
			id: `project-${index + 1}`,
			name: `Website ${index + 1}`,
		}));
		render(
			<ProjectPortfolioTable projects={projects} onProjectSelect={onSelect} />,
		);
		await user.click(screen.getByRole("button", { name: "Go to next page" }));
		expect(screen.getByText("Website 11")).toBeTruthy();
		await user.click(
			screen.getByRole("button", { name: "View project details" }),
		);
		expect(onSelect).toHaveBeenLastCalledWith("project-11");
		await user.type(screen.getByRole("textbox"), "Website 2");
		await user.click(
			screen.getByRole("button", { name: "View project details" }),
		);
		expect(onSelect).toHaveBeenLastCalledWith("project-2");
	});
	it("shows each project's hours and budget in the viewer's locale", () => {
		render(
			<ProjectPortfolioTable projects={[project]} onProjectSelect={() => {}} />,
		);

		const row = screen.getByRole("row", { name: /Website/ });
		expect(within(row).getByText("12,5 h")).toBeTruthy();
		expect(within(row).getByText("40 h")).toBeTruthy();
	});
});

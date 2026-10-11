/* @vitest-environment jsdom */

import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@/test/render-with-translations";

vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({ locale: "de-DE", timezone: "UTC", timeFormat: "24h" }),
}));

vi.mock("next/dynamic", () => ({
	default: () => () => null,
}));

import { ProjectTeamBreakdown } from "./project-team-breakdown";

describe("ProjectTeamBreakdown", () => {
	it("lists each employee's hours in the viewer's locale", () => {
		render(
			<ProjectTeamBreakdown
				teamBreakdown={[]}
				employeeBreakdown={[
					{
						employeeId: "employee-1",
						employeeName: "Ada",
						totalHours: 12.5,
						percentOfTotal: 100,
						workPeriodCount: 3,
					} as never,
				]}
			/>,
		);

		const row = screen.getByRole("row", { name: /Ada/ });
		expect(within(row).getByText("12,5 h")).toBeTruthy();
	});

	it("renders frozen report inputs without mutating them", () => {
		const members = Object.freeze([
			Object.freeze({
				employeeId: "employee-2",
				employeeName: "Two",
				totalHours: 2,
			}),
			Object.freeze({
				employeeId: "employee-1",
				employeeName: "One",
				totalHours: 1,
			}),
		]);
		const teamBreakdown = Object.freeze([
			Object.freeze({
				teamId: "team-1",
				teamName: "Team",
				totalHours: 3,
				percentOfTotal: 100,
				members,
			}),
		]);
		const employeeBreakdown = Object.freeze([
			Object.freeze({
				employeeId: "employee-2",
				employeeName: "Two",
				totalHours: 2,
				percentOfTotal: 67,
				workPeriodCount: 1,
			}),
			Object.freeze({
				employeeId: "employee-1",
				employeeName: "One",
				totalHours: 1,
				percentOfTotal: 33,
				workPeriodCount: 1,
			}),
		]);

		expect(() =>
			render(
				<ProjectTeamBreakdown
					teamBreakdown={teamBreakdown as never}
					employeeBreakdown={employeeBreakdown as never}
				/>,
			),
		).not.toThrow();
	});
});

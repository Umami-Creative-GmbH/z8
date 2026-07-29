/* @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string) => fallback ?? _key,
	}),
}));

vi.mock("next/dynamic", () => ({
	default: () => () => null,
}));

import { ProjectTeamBreakdown } from "./project-team-breakdown";

describe("ProjectTeamBreakdown", () => {
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

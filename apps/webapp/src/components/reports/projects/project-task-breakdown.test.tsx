/* @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectTaskBreakdownRow } from "@/lib/reports/project-types";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string, params?: Record<string, string>) =>
			Object.entries(params ?? {}).reduce(
				(text, [name, value]) => text.replace(`{${name}}`, value),
				fallback ?? _key,
			),
	}),
}));

vi.mock("next-intl", () => ({ useLocale: () => "en" }));

import { ProjectTaskBreakdown } from "./project-task-breakdown";

const rows: ProjectTaskBreakdownRow[] = [
	{
		taskId: "task-design",
		taskName: "Design",
		state: "open",
		totalMinutes: 150,
		totalHours: 2.5,
		workPeriodCount: 2,
		percentOfTotal: 62.5,
		estimate: { estimateHours: 10, bookedHours: 4.5, percentUsed: 45 },
	},
	{
		taskId: "task-build",
		taskName: "Build",
		state: "done",
		totalMinutes: 60,
		totalHours: 1,
		workPeriodCount: 1,
		percentOfTotal: 25,
		estimate: null,
	},
	{
		taskId: null,
		taskName: null,
		state: null,
		totalMinutes: 30,
		totalHours: 0.5,
		workPeriodCount: 1,
		percentOfTotal: 12.5,
		estimate: null,
	},
];

function rowOf(name: string) {
	const row = screen.getByText(name).closest("tr");
	if (!row) throw new Error(`no row for ${name}`);
	return within(row);
}

describe("ProjectTaskBreakdown", () => {
	afterEach(cleanup);

	it("lists hours and share per task with a No task row", () => {
		render(<ProjectTaskBreakdown taskBreakdown={Object.freeze([...rows]) as never} />);

		expect(rowOf("Design").getByText("2.5h")).toBeTruthy();
		expect(rowOf("Design").getByText("63%")).toBeTruthy();
		expect(rowOf("No task").getByText("0.5h")).toBeTruthy();
		expect(rowOf("No task").getByText("13%")).toBeTruthy();
	});

	it("marks done tasks as done", () => {
		render(<ProjectTaskBreakdown taskBreakdown={rows} />);

		expect(rowOf("Build").getByText("Done")).toBeTruthy();
		expect(rowOf("Design").queryByText("Done")).toBeNull();
	});

	it("shows estimate progress only for a task with an estimate", () => {
		render(<ProjectTaskBreakdown taskBreakdown={rows} />);

		expect(rowOf("Design").getByText("4.5h of 10h (45%)")).toBeTruthy();
		expect(rowOf("Design").getByRole("progressbar")).toBeTruthy();
		expect(rowOf("Build").queryByRole("progressbar")).toBeNull();
		expect(rowOf("No task").queryByRole("progressbar")).toBeNull();
	});

	it("says so when no time was booked", () => {
		render(<ProjectTaskBreakdown taskBreakdown={[]} />);

		expect(screen.getByText("No time was booked to this project in this period")).toBeTruthy();
	});
});

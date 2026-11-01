/* @vitest-environment jsdom */

import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
	ComparedField,
	ComparedWorkValuesView,
	WorkComparisonView,
} from "@/lib/billable-time/hand-off/views";
import { render } from "@/test/render-with-translations";
import { WorkComparison } from "./work-comparison";

vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({ locale: "en-US", timezone: "America/New_York", timeFormat: "24h" }),
}));

/** 08:00–09:30 UTC recorded at UTC+02:00. */
const handedOffValues: ComparedWorkValuesView = {
	removed: false,
	pieceCount: 1,
	removedPieceCount: 0,
	day: "2026-09-02",
	start: { at: "2026-09-02T08:00:00.000Z", offsetMinutes: 120 },
	end: { at: "2026-09-02T09:30:00.000Z", offsetMinutes: 120 },
	durationMinutes: 90,
	hours: "1.50",
	projects: [{ id: "p-web", name: "Website" }],
	customers: [{ id: "c-acme", name: "Acme" }],
	billability: "billable",
};

function comparison(
	current: Partial<ComparedWorkValuesView>,
	changedFromHandOff: ComparedField[],
	lastResolved: WorkComparisonView["lastResolved"] = null,
	changedSinceResolution: ComparedField[] | null = null,
): WorkComparisonView {
	return {
		handOff: handedOffValues,
		lastResolved,
		current: { ...handedOffValues, ...current, changedFromHandOff, changedSinceResolution },
	};
}

const rowOf = (name: string) => screen.getByRole("row", { name: new RegExp(`^${name}`) });

describe("WorkComparison", () => {
	it("shows hand-off and current values in the work's recorded offset, highlighting the change", () => {
		render(
			<WorkComparison
				label="Grace"
				comparison={comparison(
					{
						end: { at: "2026-09-02T09:45:00.000Z", offsetMinutes: 120 },
						durationMinutes: 105,
						hours: "1.75",
					},
					["end", "hours"],
				)}
			/>,
		);

		const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent);
		expect(headers).toEqual(["Field", "Hand-off", "Current"]);
		const [handOffStart, currentStart] = within(rowOf("Start")).getAllByRole("cell");
		expect(handOffStart?.textContent).toBe("10:00");
		expect(currentStart?.dataset.changed).toBeUndefined();

		const end = within(rowOf("End")).getAllByRole("cell");
		expect(end.map((cell) => cell.textContent)).toEqual([
			"11:30",
			"11:45(changed from the hand-off)",
		]);
		expect(end[1]?.dataset.changed).toBe("hand-off");
		expect(within(rowOf("Hours")).getAllByRole("cell")[1]?.textContent).toContain("1.75 h");
		expect(within(rowOf("Day")).getAllByRole("cell")[0]?.textContent).toBe("Sep 2, 2026");
	});

	it("shows the offset when the columns' offsets differ", () => {
		render(
			<WorkComparison
				label="Grace"
				comparison={comparison({ end: { at: "2026-09-02T09:30:00.000Z", offsetMinutes: 60 } }, [])}
			/>,
		);

		expect(
			within(rowOf("End"))
				.getAllByRole("cell")
				.map((cell) => cell.textContent),
		).toEqual(["11:30 (UTC+02:00)", "10:30 (UTC+01:00)"]);
	});

	it("shows hand-off, last resolved and current values, marking what changed since the resolution", () => {
		render(
			<WorkComparison
				label="Grace"
				comparison={comparison(
					{ durationMinutes: 105, hours: "1.75", billability: "non_billable" },
					["hours", "billability"],
					{
						...handedOffValues,
						durationMinutes: 105,
						hours: "1.75",
						resolvedAt: "2026-10-01T10:00:00.000Z",
						changedFromHandOff: ["hours"],
					},
					["billability"],
				)}
			/>,
		);

		expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
			"Field",
			"Hand-off",
			expect.stringContaining("Last resolved"),
			"Current",
		]);
		const hours = within(rowOf("Hours")).getAllByRole("cell");
		expect(hours[1]?.dataset.changed).toBe("hand-off");
		expect(hours[2]?.dataset.changed).toBe("hand-off");
		expect(hours[2]?.textContent).not.toContain("since the last resolution");
		const billability = within(rowOf("Billability")).getAllByRole("cell");
		expect(billability.map((cell) => cell.textContent)).toEqual([
			"Billable",
			"Billable",
			"Not billable(changed from the hand-off)(changed since the last resolution)",
		]);
	});

	it("shows removed work as removed", () => {
		render(
			<WorkComparison
				label="Grace"
				comparison={comparison(
					{
						removed: true,
						removedPieceCount: 1,
						day: null,
						start: null,
						end: null,
						durationMinutes: 0,
						hours: "0.00",
						projects: [],
						customers: [],
						billability: null,
					},
					["removed"],
				)}
			/>,
		);

		expect(
			within(rowOf("Removed"))
				.getAllByRole("cell")
				.map((cell) => cell.textContent),
		).toEqual(["No", "Yes(changed from the hand-off)"]);
		expect(within(rowOf("Project")).getAllByRole("cell")[1]?.textContent).toBe("—");
	});

	it("says when the current values sum several pieces, and names a missing customer", () => {
		render(
			<WorkComparison
				label="Grace"
				comparison={comparison({ pieceCount: 2, customers: [{ id: null, name: null }] }, [
					"customer",
				])}
			/>,
		);

		expect(within(rowOf("Customer")).getAllByRole("cell")[1]?.textContent).toContain("No customer");
		expect(screen.getByText(/2 pieces split from this work/)).toBeTruthy();
	});
});

/* @vitest-environment jsdom */

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatSignedCount, formatStatisticsFetchedAt } from "./statistics-format";
import { StatisticsSection } from "./statistics-summary";

describe("StatisticsSection", () => {
	it("renders every metric in one summary strip under a plain heading", () => {
		render(
			<StatisticsSection
				id="activity"
				locale="en"
				title="Activity Metrics"
				metrics={[
					{ key: "total", label: "Total Time Entries", value: 12345, detail: "+5 vs last month" },
					{ key: "month", label: "This Month", value: 120, unit: "Time entries" },
					{ key: "absences", label: "Total Absences", value: 7, detail: "2 pending" },
					{ key: "approvals", label: "Approval Requests", value: 3, detail: "1 pending" },
				]}
			/>,
		);

		const section = screen.getByRole("region", { name: "Activity Metrics" });
		const heading = within(section).getByRole("heading", { level: 2, name: "Activity Metrics" });
		expect(heading.querySelector("svg")).toBeNull();
		// One shared surface: a single description list holds all four metrics.
		const lists = section.querySelectorAll("dl");
		expect(lists).toHaveLength(1);
		expect(lists[0].querySelectorAll("dt")).toHaveLength(4);
		expect(within(section).getByText("12,345").className).toContain("tabular-nums");
		expect(within(section).getByText("Time entries")).toBeTruthy();
		expect(within(section).getByText("+5 vs last month")).toBeTruthy();
		expect(within(section).getByText("2 pending")).toBeTruthy();
	});

	it("formats values in the reader's locale", () => {
		render(
			<StatisticsSection
				id="core"
				locale="de"
				title="Kernzahlen"
				metrics={[{ key: "employees", label: "Mitarbeitende", value: 1234 }]}
			/>,
		);

		expect(screen.getByText("1.234")).toBeTruthy();
	});
});

describe("formatSignedCount", () => {
	it("signs increases and decreases but not zero", () => {
		expect(formatSignedCount(5, "en")).toBe("+5");
		expect(formatSignedCount(-3, "en")).toBe("-3");
		expect(formatSignedCount(0, "en")).toBe("0");
	});
});

describe("formatStatisticsFetchedAt", () => {
	it("shows the instant in the organization's zone with the zone named", () => {
		const label = formatStatisticsFetchedAt("2026-11-19T12:30:00Z", "de", "Europe/Berlin");

		expect(label).toContain("13:30");
		expect(label).toMatch(/MEZ|GMT\+1/);
	});

	it("follows the reader's locale", () => {
		const label = formatStatisticsFetchedAt("2026-11-19T12:30:00Z", "en", "America/New_York");

		expect(label).toMatch(/Nov/);
		expect(label).toMatch(/07:30\sAM/);
		expect(label).toMatch(/EST|GMT-5/);
	});

	it("falls back to UTC, named, for an unknown zone", () => {
		const label = formatStatisticsFetchedAt("2026-11-19T12:30:00Z", "en", "Not/AZone");

		expect(label).toMatch(/UTC/);
	});
});

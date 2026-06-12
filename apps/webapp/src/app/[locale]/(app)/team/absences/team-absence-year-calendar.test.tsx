// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import { Settings } from "luxon";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamAbsenceYearCalendar } from "./team-absence-year-calendar";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(message, [key, value]) => message.replaceAll(`{${key}}`, String(value)),
				fallback,
			),
	}),
}));

vi.mock("@/components/providers/user-preferences-provider", () => ({
	useWeekStartDay: () => "monday",
}));

afterEach(() => {
	Settings.now = () => Date.now();
});

describe("TeamAbsenceYearCalendar", () => {
	it("renders a year calendar with aggregate absence counts", () => {
		render(
			<TeamAbsenceYearCalendar
				data={{
					year: 2026,
					teamId: "team-1",
					entries: [
						{
							id: "absence-1",
							employeeId: "employee-1",
							employeeName: "Ada Lovelace",
							startDate: "2026-06-10",
							startPeriod: "full_day",
							endDate: "2026-06-10",
							endPeriod: "full_day",
							status: "approved",
							category: { name: "Vacation", type: "vacation", color: null },
						},
						{
							id: "absence-2",
							employeeId: "employee-2",
							employeeName: "Grace Hopper",
							startDate: "2026-06-10",
							startPeriod: "full_day",
							endDate: "2026-06-10",
							endPeriod: "full_day",
							status: "pending",
							category: { name: "Training", type: "other", color: "#f59e0b" },
						},
					],
				}}
			/>,
		);

		expect(screen.getByRole("heading", { name: "Year calendar" })).toBeTruthy();
		expect(screen.getByText("2026")).toBeTruthy();
		expect(screen.getByText("June")).toBeTruthy();
		expect(screen.getByRole("button", { name: "June 10, 2026: 2 absent, 1 pending" })).toBeTruthy();
		expect(screen.getByText("2 absent")).toBeTruthy();
		expect(screen.getByText("1 pending")).toBeTruthy();
	});

	it("renders accessible hidden details for employee names, categories, and statuses", () => {
		render(
			<TeamAbsenceYearCalendar
				data={{
					year: 2026,
					teamId: null,
					entries: [
						{
							id: "absence-1",
							employeeId: "employee-1",
							employeeName: "Ada Lovelace",
							startDate: "2026-03-04",
							startPeriod: "full_day",
							endDate: "2026-03-04",
							endPeriod: "full_day",
							status: "approved",
							category: { name: "Vacation", type: "vacation", color: null },
						},
					],
				}}
			/>,
		);

		const details = screen.getByTestId("team-absence-calendar-details-2026-03-04");
		expect(within(details).getByText("Ada Lovelace")).toBeTruthy();
		expect(within(details).getByText("Vacation")).toBeTruthy();
		expect(within(details).getByText("Approved")).toBeTruthy();
	});

	it("labels the current day when the selected year contains today", () => {
		Settings.now = () => new Date("2026-06-12T10:00:00.000Z").valueOf();

		render(
			<TeamAbsenceYearCalendar
				data={{
					year: 2026,
					teamId: null,
					entries: [],
				}}
			/>,
		);

		expect(screen.getByRole("button", { name: "Today, June 12, 2026" })).toBeTruthy();
	});

	it("does not label the same month and day as today in other selected years", () => {
		Settings.now = () => new Date("2026-06-12T10:00:00.000Z").valueOf();

		render(
			<TeamAbsenceYearCalendar
				data={{
					year: 2025,
					teamId: null,
					entries: [],
				}}
			/>,
		);

		expect(screen.queryByRole("button", { name: /Today,/ })).toBeNull();
		expect(screen.getByRole("button", { name: "June 12, 2025" })).toBeTruthy();
	});
});

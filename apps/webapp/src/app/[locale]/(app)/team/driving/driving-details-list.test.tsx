// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { TeamDrivingDetailsRow } from "@/lib/time-tracking/vehicle-use/driving-details-team-store";
import { DrivingDetailsList } from "./driving-details-list";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("@tolgee/react", () => ({
	useTolgee: () => ({ getLanguage: () => "en-GB" }),
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(message, [key, value]) => message.replaceAll(`{${key}}`, String(value)),
				fallback,
			),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/components/providers/user-preferences-provider", () => ({
	useTimeFormat: () => "24h",
}));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: navigation.push, refresh: vi.fn() }),
	Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

const row = (overrides: Partial<TeamDrivingDetailsRow>): TeamDrivingDetailsRow => ({
	workPeriodId: "work-1",
	employeeId: "employee-1",
	name: "Ada",
	teamName: "Field",
	former: false,
	workDay: "2026-09-07",
	startedAt: "2026-09-07T06:00:00Z",
	endedAt: "2026-09-07T14:00:00Z",
	startOffsetMinutes: 120,
	endOffsetMinutes: 120,
	missing: "vehicle",
	...overrides,
});

describe("the driving details missing list (#1127)", () => {
	it("keeps captured start-local dates, distinct endpoint offsets and every missing-evidence label", () => {
		render(
			<DrivingDetailsList
				teams={[]}
				employees={[]}
				filters={{ teamId: null, employeeId: null }}
				truncated={true}
				rows={[
					row({
						startedAt: "2026-09-07T23:30:00Z",
						endedAt: "2026-09-08T04:00:00Z",
						workDay: "2026-09-08",
						startOffsetMinutes: 120,
						endOffsetMinutes: -240,
					}),
					row({ workPeriodId: "readings", missing: "readings" }),
					row({ workPeriodId: "start", missing: "start_reading" }),
					row({ workPeriodId: "end", missing: "end_reading" }),
				]}
			/>,
		);
		const first = screen.getAllByRole("row")[1];
		expect(within(first).getByText("Sep 8, 2026")).toBeTruthy();
		expect(within(first).getByText("01:30 – 00:00")).toBeTruthy();
		expect(within(first).getByRole("link").getAttribute("href")).toBe(
			"/calendar/employee-1?date=2026-09-08",
		);
		for (const label of [
			"No vehicle",
			"No odometer readings",
			"No start reading",
			"No end reading",
		])
			expect(screen.getByText(label)).toBeTruthy();
		expect(
			screen.getByText(
				"Showing the newest 4 work periods. Filter by team or employee to see the rest.",
			),
		).toBeTruthy();
	});

	it("distinguishes a filtered no-match and lets the reader return to all work", () => {
		render(
			<DrivingDetailsList
				teams={[{ id: "team-1", name: "Field" }]}
				employees={[]}
				filters={{ teamId: "team-1", employeeId: null }}
				rows={[]}
				truncated={false}
			/>,
		);
		expect(screen.getByText("No missing driving details match these filters.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
		expect(navigation.push).toHaveBeenCalledWith("/team/driving");
	});

	it("shows each flagged work period at its recorded local time, what it lacks, and the employee's calendar", () => {
		render(
			<DrivingDetailsList
				teams={[{ id: "team-1", name: "Field" }]}
				employees={[{ id: "employee-1", name: "Ada", teamId: "team-1" }]}
				filters={{ teamId: null, employeeId: null }}
				rows={[
					row({}),
					row({ workPeriodId: "work-2", workDay: "2026-09-08", missing: "end_reading" }),
				]}
				truncated={false}
			/>,
		);

		const [, first, second] = screen.getAllByRole("row");
		expect(within(first).getByText("No vehicle")).toBeTruthy();
		expect(within(first).getByText(/08:00/)).toBeTruthy();
		expect(within(second).getByText("No end reading")).toBeTruthy();
		expect(
			within(second).getByRole("link", { name: "Open the calendar of Ada" }).getAttribute("href"),
		).toBe("/calendar/employee-1?date=2026-09-08");
		expect(screen.getByText(/missing driving details\.$/)).toBeTruthy();
	});

	it("marks a former employee's work as former, with the date they left (#1438, #1439)", () => {
		render(
			<DrivingDetailsList
				teams={[]}
				employees={[]}
				filters={{ teamId: null, employeeId: null }}
				rows={[
					row({}),
					row({
						workPeriodId: "work-2",
						employeeId: "employee-2",
						name: "Bo",
						former: true,
						formerSince: "2026-10-12",
					}),
					row({
						workPeriodId: "work-3",
						employeeId: "employee-3",
						name: "Cy",
						former: true,
						formerSince: null,
					}),
				]}
				truncated={false}
			/>,
		);

		const [, current, former, unrecorded] = screen.getAllByRole("row");
		expect(within(current).queryByText(/Former/)).toBeNull();
		expect(within(former).getByText("Former since 12 Oct 2026")).toBeTruthy();
		expect(within(unrecorded).getByText("Former · date not recorded")).toBeTruthy();
	});

	it("says so when nothing is missing", () => {
		render(
			<DrivingDetailsList
				teams={[]}
				employees={[]}
				filters={{ teamId: null, employeeId: null }}
				rows={[]}
				truncated={false}
			/>,
		);
		expect(screen.getByText("No work is missing driving details.")).toBeTruthy();
	});
});

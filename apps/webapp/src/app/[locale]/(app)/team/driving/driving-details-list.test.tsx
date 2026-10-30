// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { TeamDrivingDetailsRow } from "@/lib/time-tracking/vehicle-use/driving-details-team-store";
import { DrivingDetailsList } from "./driving-details-list";

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
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
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

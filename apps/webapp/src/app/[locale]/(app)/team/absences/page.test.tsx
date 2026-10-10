// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getManagerAbsenceEmployees = vi.fn();
const getManagerAbsenceCalendar = vi.fn();

vi.mock("next/navigation", () => ({
	redirect: vi.fn(),
}));

vi.mock("next/server", () => ({
	connection: vi.fn(async () => undefined),
}));

vi.mock("@/components/errors/no-employee-error", () => ({
	NoEmployeeError: () => null,
}));

vi.mock("@/tolgee/server", () => ({
	getTranslate: () => (_key: string, fallback: string) => fallback,
}));

vi.mock("../../absences/queries", () => ({
	getAbsenceCategories: vi.fn(async () => []),
}));

vi.mock("../actions", () => ({
	getCurrentEmployee: vi.fn(async () => ({
		id: "employee-1",
		organizationId: "org-1",
		role: "manager",
	})),
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

vi.mock("./actions", () => ({
	getManagerAbsenceEmployees,
	getManagerAbsenceCalendar,
}));

vi.mock("./team-absences-table", () => ({
	TeamAbsencesTable: () => <div data-testid="team-absences-table" />,
}));

vi.mock("./team-absence-year-calendar", () => ({
	TeamAbsenceYearCalendar: ({ data }: { data: { year: number; entries: unknown[] } }) => (
		<div data-testid="team-absence-year-calendar">{`${data.year}:${data.entries.length}`}</div>
	),
}));

const { TeamAbsencesPageContent } = await import("./page");

describe("TeamAbsencesPage", () => {
	beforeEach(() => {
		getManagerAbsenceEmployees.mockReset();
		getManagerAbsenceCalendar.mockReset();
		getManagerAbsenceEmployees.mockResolvedValue({
			success: true,
			data: {
				rows: [],
				total: 0,
				page: 1,
				pageSize: 25,
				year: 2026,
				pageCount: 0,
			},
		});
		getManagerAbsenceCalendar.mockResolvedValue({
			success: true,
			data: { year: 2026, teamId: null, entries: [] },
		});
	});

	it("passes team and sort URL state to the manager absence list", async () => {
		await TeamAbsencesPageContent({
			searchParams: Promise.resolve({
				search: " Ada ",
				page: "2",
				pageSize: "50",
				year: "2026",
				teamId: "team-1",
				sort: "remainingVacationDays",
				direction: "desc",
			}),
		});

		expect(getManagerAbsenceEmployees).toHaveBeenCalledWith({
			search: "Ada",
			page: 2,
			pageSize: 50,
			year: 2026,
			teamId: "team-1",
			sort: "remainingVacationDays",
			direction: "desc",
		});
	});

	it("passes only selected year and team state to the manager absence calendar", async () => {
		await TeamAbsencesPageContent({
			searchParams: Promise.resolve({
				search: " Ada ",
				page: "2",
				pageSize: "50",
				year: "2026",
				teamId: "team-1",
				sort: "remainingVacationDays",
				direction: "desc",
			}),
		});

		expect(getManagerAbsenceCalendar).toHaveBeenCalledWith({
			year: 2026,
			teamId: "team-1",
		});
	});

	it("narrows the calendar to the absences a departing employee covers, from the offboarding link (#1014)", async () => {
		const result = await TeamAbsencesPageContent({
			searchParams: Promise.resolve({
				year: "2026",
				deputy: "e1014000-0000-4000-8000-000000000001",
				coverAt: "2026-09-30T22:00:00Z",
			}),
		});
		render(result);

		expect(getManagerAbsenceCalendar).toHaveBeenCalledWith({
			year: 2026,
			teamId: undefined,
			deputyCover: {
				deputyEmployeeId: "e1014000-0000-4000-8000-000000000001",
				at: "2026-09-30T22:00:00Z",
			},
		});
		expect(screen.getByText("Showing only the absences this employee covers as deputy.")).toBeTruthy();
		expect(screen.getByRole("link", { name: "Show all absences" }).getAttribute("href")).toBe(
			"/team/absences?year=2026",
		);
	});

	it("ignores a malformed deputy filter", async () => {
		await TeamAbsencesPageContent({
			searchParams: Promise.resolve({ year: "2026", deputy: "anna", coverAt: "yesterday" }),
		});

		expect(getManagerAbsenceCalendar).toHaveBeenCalledWith({ year: 2026, teamId: undefined });
	});

	it("renders the calendar above the existing table", async () => {
		const result = await TeamAbsencesPageContent({
			searchParams: Promise.resolve({ year: "2026" }),
		});

		render(result);

		const calendar = screen.getByTestId("team-absence-year-calendar");
		const table = screen.getByTestId("team-absences-table");

		expect(getManagerAbsenceCalendar).toHaveBeenCalledWith({ year: 2026, teamId: undefined });
		expect(calendar.compareDocumentPosition(table)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
	});
});

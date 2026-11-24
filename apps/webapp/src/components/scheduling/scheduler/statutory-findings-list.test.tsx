/* @vitest-environment jsdom */

import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StatutoryComplianceFinding } from "@/lib/scheduling/compliance/types";
import type {
	ScheduleStatutoryFindingItem,
	ScheduleStatutoryFindings,
} from "@/lib/statutory/scheduling/findings-list";

const language = vi.hoisted(() => ({ current: "en" }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			fallback
				.replace(
					/\{(\w+), plural, one \{([^}]*)\} other \{([^}]*)\}\}/g,
					(_match, name: string, one: string, other: string) =>
						(Number(params?.[name]) === 1 ? one : other).replace("#", String(params?.[name])),
				)
				.replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match)),
	}),
	useTolgee: () => ({ getLanguage: () => language.current }),
}));
vi.mock("@/navigation", () => ({
	Link: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

const { UserPreferencesProvider } =
	await import("@/components/providers/user-preferences-provider");
const { StatutoryFindingsList } = await import("./statutory-findings-list");
const { ScheduleComplianceBanner } = await import("./schedule-compliance-banner");

const ANNA = "0b4f7d0e-5c3a-4a8e-9d55-6a1f0f3b9a01";
const BEN = "1c5e8e1f-6d4b-4b9f-8e66-7b2a1a4cab02";
const RANGE = { startDate: "2027-03-01", endDateExclusive: "2027-03-08" };

function finding(overrides: Partial<StatutoryComplianceFinding>): StatutoryComplianceFinding {
	return {
		type: "statutory",
		employeeId: ANNA,
		findingId: "kind:employee:subject",
		statutoryKind: "jarbschg_daily_max",
		domain: "youth_protection",
		severity: "critical",
		subjectKey: "shift:s1",
		legalReference: "§ 8 Abs. 1 JArbSchG",
		summary: {
			tier: "exceeded",
			used: { unit: "minutes", value: 600 },
			limit: { unit: "minutes", value: 480 },
		},
		day: "2027-03-02",
		acknowledgementStatus: null,
		blocksPublication: true,
		...overrides,
	};
}

const youthDay: ScheduleStatutoryFindingItem = {
	employeeName: "Anna Berg",
	finding: finding({}),
	period: { start: "2027-03-02", endExclusive: "2027-03-03" },
	blocksThisPublication: true,
};
const minijobMonth: ScheduleStatutoryFindingItem = {
	employeeName: "Ben Carter",
	finding: finding({
		employeeId: BEN,
		findingId: `minijob_monthly_cap:${BEN}:2027-03`,
		statutoryKind: "minijob_monthly_cap",
		domain: "minijob",
		severity: "warning",
		subjectKey: "2027-03",
		legalReference: "§ 8 Abs. 1 Nr. 1 SGB IV",
		summary: { tier: "critical" },
		day: undefined,
		acknowledgementStatus: "none",
		blocksPublication: false,
	}),
	period: { start: "2027-03-01", endExclusive: "2027-04-01" },
	blocksThisPublication: false,
};

function findings(overrides: Partial<ScheduleStatutoryFindings> = {}): ScheduleStatutoryFindings {
	return {
		items: [youthDay, minijobMonth],
		outsideScopeCount: 0,
		canOpenReviews: false,
		...overrides,
	};
}

beforeEach(() => {
	language.current = "en";
});

describe("StatutoryFindingsList", () => {
	it("names who, which limit and which day, its severity and whether it blocks publishing", () => {
		render(<StatutoryFindingsList findings={findings()} dateRange={RANGE} />);

		const list = screen.getByRole("list", { name: "Statutory findings" });
		const [youth, minijob] = within(list).getAllByRole("listitem");

		expect(within(youth).getByText("Anna Berg")).toBeTruthy();
		// The day stands beside the text, once.
		expect(
			within(youth).getByText("Under 18: 600 min of work this day exceeds the 480 min youth limit"),
		).toBeTruthy();
		expect(within(youth).getByText("Mar 2, 2027")).toBeTruthy();
		expect(within(youth).getByText("Critical")).toBeTruthy();
		expect(within(youth).getByText("Blocks publishing")).toBeTruthy();
		expect(
			within(youth).getByRole("link", { name: "Show Anna Berg's shifts" }).getAttribute("href"),
		).toBe(`/scheduling?employeeId=${ANNA}&date=2027-03-02`);

		expect(within(minijob).getByText("Ben Carter")).toBeTruthy();
		expect(within(minijob).getByText("Warning")).toBeTruthy();
		expect(within(minijob).queryByText("Blocks publishing")).toBeNull();
		// A month finding opens the calendar on the first day of the range it touches.
		expect(
			within(minijob).getByRole("link", { name: "Show Ben Carter's shifts" }).getAttribute("href"),
		).toBe(`/scheduling?employeeId=${BEN}&date=2027-03-01`);
	});

	it("says 'Blocks publishing' only where this publication is refused for it, not for a published shift's breach", () => {
		const publishedBreach = { ...youthDay, blocksThisPublication: false };
		render(
			<StatutoryFindingsList findings={findings({ items: [publishedBreach] })} dateRange={RANGE} />,
		);

		const row = screen.getByRole("listitem");
		expect(within(row).getByText("Critical")).toBeTruthy();
		expect(within(row).queryByText("Blocks publishing")).toBeNull();
	});

	it("keeps its list semantics where list styles are removed (Safari)", () => {
		render(<StatutoryFindingsList findings={findings()} dateRange={RANGE} />);

		expect(screen.getByRole("list", { name: "Statutory findings" }).getAttribute("role")).toBe(
			"list",
		);
	});

	it("shows an earnings-derived finding by its tier and month only", () => {
		render(<StatutoryFindingsList findings={findings()} dateRange={RANGE} />);

		const minijob = screen.getAllByRole("listitem")[1];
		expect(within(minijob).getByText("Minijob monthly limit approaching")).toBeTruthy();
		expect(within(minijob).getByText("March 2027")).toBeTruthy();
		expect(minijob.textContent).not.toMatch(/%|€|EUR/);
	});

	it("links only where the employee has shifts in the calendar", () => {
		render(
			<StatutoryFindingsList
				findings={findings()}
				dateRange={RANGE}
				shiftEmployeeIds={new Set([ANNA])}
			/>,
		);

		expect(screen.getByRole("link", { name: "Show Anna Berg's shifts" })).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Show Ben Carter's shifts" })).toBeNull();
	});

	it("gives org admins the matching Reviews & Conflicts domain", () => {
		render(
			<StatutoryFindingsList findings={findings({ canOpenReviews: true })} dateRange={RANGE} />,
		);

		const links = screen.getAllByRole("link", { name: /Reviews & Conflicts/ });
		expect(links.map((link) => link.getAttribute("href"))).toEqual([
			"/settings/contracts?tab=reviews&domain=youth_apprentice",
			"/settings/contracts?tab=reviews&domain=minijob",
		]);
	});

	it("never offers Reviews & Conflicts below org admin, and counts findings out of reach", () => {
		render(
			<StatutoryFindingsList findings={findings({ outsideScopeCount: 3 })} dateRange={RANGE} />,
		);

		expect(screen.queryByRole("link", { name: /Reviews & Conflicts/ })).toBeNull();
		expect(screen.getByText("3 more findings concern employees you don't manage.")).toBeTruthy();
	});

	it("counts findings out of reach without 'more' when none is listed", () => {
		render(
			<StatutoryFindingsList
				findings={findings({ items: [], outsideScopeCount: 1 })}
				dateRange={RANGE}
			/>,
		);

		expect(screen.queryByRole("list")).toBeNull();
		expect(screen.getByText("1 finding concerns an employee you don't manage.")).toBeTruthy();
	});

	it("tells its host when a shift link is followed", () => {
		const onShiftLinkClick = vi.fn();
		render(
			<StatutoryFindingsList
				findings={findings()}
				dateRange={RANGE}
				onShiftLinkClick={onShiftLinkClick}
			/>,
		);

		fireEvent.click(screen.getByRole("link", { name: "Show Anna Berg's shifts" }));

		expect(onShiftLinkClick).toHaveBeenCalledTimes(1);
	});

	/** One listed finding of Anna's with the given kind and period, no named day. */
	function periodItem(
		statutoryKind: string,
		domain: StatutoryComplianceFinding["domain"],
		period: { start: string; endExclusive: string },
		overrides: Partial<StatutoryComplianceFinding> = {},
	): ScheduleStatutoryFindingItem {
		return {
			employeeName: "Anna Berg",
			finding: finding({
				findingId: `${statutoryKind}:${ANNA}:${period.start}`,
				statutoryKind,
				domain,
				severity: "warning",
				subjectKey: period.start,
				summary: { tier: "warning", usedPercent: 90 },
				day: undefined,
				blocksPublication: false,
				...overrides,
			}),
			period,
			blocksThisPublication: false,
		};
	}

	function whenAndLink(item: ScheduleStatutoryFindingItem) {
		render(<StatutoryFindingsList findings={findings({ items: [item] })} dateRange={RANGE} />);
		const row = screen.getByRole("listitem");
		return {
			row,
			href: within(row).getByRole("link", { name: "Show Anna Berg's shifts" }).getAttribute("href"),
		};
	}

	it("names the week of a working-student week", () => {
		const { row, href } = whenAndLink(
			periodItem("working_student_lecture_week", "working_student", {
				start: "2027-03-01",
				endExclusive: "2027-03-08",
			}),
		);

		expect(within(row).getByText("Mar 1 – 7, 2027")).toBeTruthy();
		expect(href).toBe(`/scheduling?employeeId=${ANNA}&date=2027-03-01`);
	});

	it("names the week of an on-call week", () => {
		const { row } = whenAndLink(
			periodItem("on_call_weekly_over_band", "on_call", {
				start: "2027-03-01",
				endExclusive: "2027-03-08",
			}),
		);

		expect(within(row).getByText("Mar 1 – 7, 2027")).toBeTruthy();
	});

	it("names the year of a short-term year and opens the calendar on the visible range", () => {
		const { row, href } = whenAndLink(
			periodItem("short_term_work_days", "short_term", {
				start: "2027-01-01",
				endExclusive: "2028-01-01",
			}),
		);

		expect(within(row).getByText("Jan 1 – Dec 31, 2027")).toBeTruthy();
		// The year starts before the visible range: the link opens the range, not 1 January.
		expect(href).toBe(`/scheduling?employeeId=${ANNA}&date=2027-03-01`);
	});

	it("names a rolling 12-month window and opens the calendar on the visible range", () => {
		const { row, href } = whenAndLink(
			periodItem("minijob_rolling_12m_cap", "minijob", {
				start: "2026-04-01",
				endExclusive: "2027-04-01",
			}),
		);

		expect(within(row).getByText("Apr 1, 2026 – Mar 31, 2027")).toBeTruthy();
		expect(href).toBe(`/scheduling?employeeId=${ANNA}&date=2027-03-01`);
	});

	it("names the day of a single-day on-call finding", () => {
		const { row, href } = whenAndLink(
			periodItem("on_call_short_notice", "on_call", {
				start: "2027-03-04",
				endExclusive: "2027-03-05",
			}),
		);

		expect(within(row).getByText("Mar 4, 2027")).toBeTruthy();
		expect(href).toBe(`/scheduling?employeeId=${ANNA}&date=2027-03-04`);
	});

	it.each([
		[
			"jarbschg_weekly_max",
			{ used: { unit: "minutes", value: 2_700 }, limit: { unit: "minutes", value: 2_400 } },
		],
		[
			"jarbschg_days_per_week",
			{ used: { unit: "days", value: 6 }, limit: { unit: "days", value: 5 } },
		],
	] as const)(
		"names the week (Monday to Sunday) of a %s finding, and opens its shift's day",
		(kind, summary) => {
			// Thursday's shift is past the week's limit.
			const { row, href } = whenAndLink({
				employeeName: "Anna Berg",
				finding: finding({
					statutoryKind: kind,
					summary: { tier: "exceeded", ...summary },
					day: "2027-03-04",
				}),
				period: { start: "2027-03-04", endExclusive: "2027-03-05" },
				blocksThisPublication: false,
			});

			expect(within(row).getByText("Week of Mar 1, 2027")).toBeTruthy();
			// Named once, beside the text, not again in it.
			expect(row.textContent?.match(/Mar 1, 2027/g)).toHaveLength(1);
			expect(href).toBe(`/scheduling?employeeId=${ANNA}&date=2027-03-04`);
		},
	);

	it("lists a finding whose employee has no name on record as an unnamed employee", () => {
		render(
			<StatutoryFindingsList
				findings={findings({ items: [{ ...youthDay, employeeName: "" }] })}
				dateRange={RANGE}
			/>,
		);

		const row = screen.getByRole("listitem");
		expect(within(row).getByText("Unnamed employee")).toBeTruthy();
		expect(within(row).getByRole("link", { name: "Show Unnamed employee's shifts" })).toBeTruthy();
		expect(row.textContent).not.toContain(ANNA);
	});

	it("writes clock times in the reader's time format", () => {
		render(
			<UserPreferencesProvider timeFormat="12h">
				<StatutoryFindingsList
					findings={findings({
						items: [
							{
								...youthDay,
								finding: finding({
									statutoryKind: "jarbschg_night_work",
									legalReference: "§ 14 JArbSchG",
									summary: { tier: "exceeded", used: { unit: "minutes", value: 60 } },
									acknowledgementStatus: "none",
									blocksPublication: false,
								}),
							},
						],
					})}
					dateRange={RANGE}
				/>
			</UserPreferencesProvider>,
		);

		expect(
			screen.getByText("Under 18: 60 min of night work between 8:00 PM and 6:00 AM"),
		).toBeTruthy();
	});

	it("writes dates in the reader's language", () => {
		language.current = "de";
		render(<StatutoryFindingsList findings={findings()} dateRange={RANGE} />);

		expect(screen.getByText("2. März 2027")).toBeTruthy();
		expect(screen.getByText("März 2027")).toBeTruthy();
	});
});

describe("ScheduleComplianceBanner", () => {
	const summary = {
		totalFindings: 2,
		byType: { restTime: 0, maxHours: 0, overtime: 0, statutory: 2 },
	};

	it("expands the statutory count into the list of findings", () => {
		render(
			<ScheduleComplianceBanner
				summary={summary}
				statutoryFindings={findings()}
				dateRange={RANGE}
			/>,
		);

		const toggle = screen.getByRole("button", { name: "Show statutory findings (2)" });
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		expect(screen.queryByRole("list", { name: "Statutory findings" })).toBeNull();

		fireEvent.click(toggle);

		expect(toggle.getAttribute("aria-expanded")).toBe("true");
		const list = screen.getByRole("list", { name: "Statutory findings" });
		expect(toggle.getAttribute("aria-controls")).toBe(list.parentElement?.id);
		expect(within(list).getAllByRole("listitem")).toHaveLength(2);
	});

	it("does not say a published shift's breach blocks publishing the drafts", () => {
		render(
			<ScheduleComplianceBanner
				summary={summary}
				statutoryFindings={findings({ items: [{ ...youthDay, blocksThisPublication: false }] })}
				dateRange={RANGE}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Show statutory findings (1)" }));

		const row = within(screen.getByRole("list", { name: "Statutory findings" })).getByRole(
			"listitem",
		);
		expect(within(row).getByText("Anna Berg")).toBeTruthy();
		expect(within(row).queryByText("Blocks publishing")).toBeNull();
	});

	it("tells a scoped manager, while collapsed, that the list holds only some of the findings", () => {
		render(
			<ScheduleComplianceBanner
				summary={{ ...summary, totalFindings: 4, byType: { ...summary.byType, statutory: 4 } }}
				statutoryFindings={findings({ outsideScopeCount: 2 })}
				dateRange={RANGE}
			/>,
		);

		const toggle = screen.getByRole("button", { name: "Show statutory findings (2 of 4)" });
		fireEvent.click(toggle);

		expect(toggle.textContent).toBe("Hide statutory findings (2 of 4)");
		expect(screen.getByText("2 more findings concern employees you don't manage.")).toBeTruthy();
	});

	it("offers no list when a scoped manager reaches none of the findings", () => {
		render(
			<ScheduleComplianceBanner
				summary={summary}
				statutoryFindings={findings({ items: [], outsideScopeCount: 2 })}
				dateRange={RANGE}
			/>,
		);

		expect(screen.queryByRole("button", { name: /Show statutory findings/ })).toBeNull();
		expect(screen.getByText("2 findings concern employees you don't manage.")).toBeTruthy();
		expect(screen.queryByText(/more finding/)).toBeNull();
	});
});

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
		expect(
			within(youth).getByText(
				"Under 18: 600 min of work on Mar 2, 2027 exceeds the 480 min youth limit",
			),
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

	it("offers no list when a scoped manager reaches none of the findings", () => {
		render(
			<ScheduleComplianceBanner
				summary={summary}
				statutoryFindings={findings({ items: [], outsideScopeCount: 2 })}
				dateRange={RANGE}
			/>,
		);

		expect(screen.queryByRole("button", { name: /Show statutory findings/ })).toBeNull();
		expect(screen.getByText("2 more findings concern employees you don't manage.")).toBeTruthy();
	});
});

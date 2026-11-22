import { describe, expect, it } from "vitest";
import {
	adoptionCards,
	attentionCards,
	monthCards,
	type StatisticsLinks,
	type Translate,
	workforceCards,
} from "./statistics-cards";
import { formatComparisonDays } from "./statistics-format";
import type { AttentionStatistics, MonthStatistics, WorkforceStatistics } from "./statistics-types";

/** English defaults with `{name}` filled in; plural messages keep their source text. */
const t: Translate = (_key, defaultValue, params = {}) =>
	defaultValue.includes("plural")
		? `${defaultValue} ${JSON.stringify(params)}`
		: defaultValue.replace(/\{(\w+)\}/g, (_match, name: string) =>
				String(params[name] ?? `{${name}}`),
			);
const context = { t, locale: "en" };

const allLinks: StatisticsLinks = { approvals: true, payrollReadiness: true, workPolicies: true };
const noLinks: StatisticsLinks = { approvals: false, payrollReadiness: false, workPolicies: false };

const ok = <T>(value: T) => ({ status: "ok" as const, value });
const failed = { status: "failed" as const };

describe("attentionCards", () => {
	const quiet: AttentionStatistics = { staleLiveWork: ok(0), openViolations: ok(0) };

	it("is all clear only when every figure loaded and is zero", () => {
		expect(
			attentionCards(quiet, ok({ pending: 0, absenceRequests: 0 }), allLinks, context).allClear,
		).toBe(true);
		expect(attentionCards(quiet, ok(null), allLinks, context).allClear).toBe(true);
		expect(attentionCards(quiet, failed, allLinks, context).allClear).toBe(false);
		expect(
			attentionCards({ ...quiet, staleLiveWork: failed }, ok(null), allLinks, context).allClear,
		).toBe(false);
		expect(
			attentionCards(quiet, ok({ pending: 1, absenceRequests: 0 }), allLinks, context).allClear,
		).toBe(false);
	});

	it("shows a failed figure as unknown, never as zero", () => {
		const { cards } = attentionCards(
			{ ...quiet, staleLiveWork: failed },
			ok(null),
			allLinks,
			context,
		);
		const stale = cards.find((card) => card.key === "staleLiveWork");

		expect(stale).toMatchObject({ value: "—", caption: "Couldn't load", tone: "neutral" });
		expect(stale?.link).toBeUndefined();
	});

	it("turns waiting figures amber and links them only where the viewer can act", () => {
		const data: AttentionStatistics = { staleLiveWork: ok(2), openViolations: ok(0) };
		const withLinks = attentionCards(
			data,
			ok({ pending: 3, absenceRequests: 1 }),
			allLinks,
			context,
		);
		const withoutLinks = attentionCards(
			data,
			ok({ pending: 3, absenceRequests: 1 }),
			noLinks,
			context,
		);

		expect(withLinks.cards.map((card) => [card.key, card.tone, card.link?.href])).toEqual([
			["pendingApprovals", "warning", "/approvals/inbox"],
			["staleLiveWork", "warning", "/payroll"],
			["openViolations", "neutral", "/settings/work-policies"],
		]);
		expect(withoutLinks.cards.every((card) => card.link === undefined)).toBe(true);
	});

	it("leaves out the approvals figure for a viewer without an inbox", () => {
		const { cards } = attentionCards(quiet, ok(null), allLinks, context);

		expect(cards.map((card) => card.key)).toEqual(["staleLiveWork", "openViolations"]);
	});
});

describe("monthCards", () => {
	const data: MonthStatistics = {
		comparison: { firstDay: "2026-10-01", lastDay: "2026-10-05" },
		workedMinutes: ok({ current: 750, previous: 600 }),
		absenceDays: ok({ current: 2.5, previous: 4 }),
		completedWorkPeriods: failed,
	};

	it("compares like for like in a neutral tone, in hours for worked time", () => {
		const [hours, absence, periods] = monthCards(data, context);

		expect(hours).toMatchObject({ value: "12.5", unit: "h", tone: "neutral" });
		// Intl separates the range with thin spaces.
		expect(hours.trend?.direction).toBe("up");
		expect(hours.trend?.label).toMatch(/^\+2\.5 vs\. Oct 1\s–\s5$/);
		expect(absence.trend?.direction).toBe("down");
		expect(absence.trend?.label).toMatch(/^-1\.5 vs\. Oct 1\s–\s5$/);
		expect(periods).toMatchObject({ value: "—", caption: "Couldn't load" });
	});
});

describe("adoptionCards", () => {
	it("shows coverage as a share with progress and no status colour", () => {
		const [coverage] = adoptionCards(
			{
				coverage: ok({ tracked: 9, expected: 12 }),
				clockedIn: ok(0),
				manualEntryShare: ok({ manualMinutes: 0, totalMinutes: 0 }),
			},
			context,
		);

		expect(coverage).toMatchObject({
			value: "75%",
			tone: "neutral",
			progress: { value: 9, max: 12 },
			caption: "9 of 12 employees with required time recorded work",
		});
	});

	it("says why a share has no value instead of showing 0%", () => {
		const [coverage, , manual] = adoptionCards(
			{
				coverage: ok({ tracked: 0, expected: 0 }),
				clockedIn: ok(0),
				manualEntryShare: ok({ manualMinutes: 0, totalMinutes: 0 }),
			},
			context,
		);

		expect(coverage).toMatchObject({
			value: "—",
			caption: "No one has required time yet this month",
		});
		expect(manual).toMatchObject({ value: "—", caption: "No completed work this month yet" });
	});
});

describe("workforceCards", () => {
	const data: WorkforceStatistics = {
		roster: ok({ roster: 48, joined: 2, left: 1 }),
		teams: ok(5),
		incompleteSetup: ok(3),
	};

	it("shows roster movement and flags incomplete setup", () => {
		const cards = workforceCards(data, { organizationWide: true }, context);

		expect(cards.map((card) => card.key)).toEqual(["employees", "teams", "incompleteSetup"]);
		expect(cards[0]).toMatchObject({ value: "48", caption: "+2 joined, −1 left this month" });
		expect(cards[2]).toMatchObject({
			tone: "warning",
			caption: "Employees with no primary team or no work policy",
		});
	});

	it("names only the missing work policy for a manager, and users signed in only when read", () => {
		const managerCards = workforceCards(data, { organizationWide: false }, context);
		const adminCards = workforceCards(
			{ ...data, usersSignedIn: ok(7) },
			{ organizationWide: true },
			context,
		);

		expect(managerCards[2].caption).toBe("Employees with no work policy");
		expect(managerCards.map((card) => card.key)).not.toContain("usersSignedIn");
		expect(adminCards.at(-1)).toMatchObject({ key: "usersSignedIn", value: "7" });
	});
});

describe("formatComparisonDays", () => {
	it("formats the comparison window's calendar days in the reader's locale", () => {
		expect(formatComparisonDays({ firstDay: "2026-02-01", lastDay: "2026-02-28" }, "en")).toMatch(
			/^Feb 1\s–\s28$/,
		);
		expect(formatComparisonDays({ firstDay: "2026-10-01", lastDay: "2026-10-05" }, "de")).toMatch(
			/^1\.\s?–\s?5\. Okt\.$/,
		);
	});
});

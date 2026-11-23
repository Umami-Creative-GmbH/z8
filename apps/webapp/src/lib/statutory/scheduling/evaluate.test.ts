import { describe, expect, it } from "vitest";
import type { StatutoryFinding, StatutoryFindingSummary } from "../finding";
import { restrictedSummary } from "../redaction";
import { deepensBreachedLimit, toStatutoryComplianceFinding } from "./evaluate";

const minutes = (value: number) => ({ unit: "minutes" as const, value });
const days = (value: number) => ({ unit: "days" as const, value });
const of = (summary: StatutoryFindingSummary) => ({ summary });

describe("deepensBreachedLimit", () => {
	it("deepens a ceiling when used grows further above it", () => {
		const before = of({ used: minutes(2_460), limit: minutes(2_400) });
		expect(deepensBreachedLimit(before, of({ used: minutes(2_520), limit: minutes(2_400) }))).toBe(
			true,
		);
		// Less, or the same, past the ceiling is no deeper.
		expect(deepensBreachedLimit(before, of({ used: minutes(2_430), limit: minutes(2_400) }))).toBe(
			false,
		);
		expect(deepensBreachedLimit(before, of({ used: minutes(2_460), limit: minutes(2_400) }))).toBe(
			false,
		);
	});

	it("does not count growth below a ceiling (an under-band) as deeper", () => {
		expect(
			deepensBreachedLimit(
				of({ used: minutes(300), limit: minutes(1_200) }),
				of({ used: minutes(780), limit: minutes(1_200) }),
			),
		).toBe(false);
	});

	it("deepens a floor when used falls further below it, never when it rises", () => {
		const floor = (used: number) =>
			of({ used: minutes(used), limit: minutes(720), limitDirection: "floor" });
		// A youth rest period of 10.5 h cut to 10 h.
		expect(deepensBreachedLimit(floor(630), floor(600))).toBe(true);
		expect(deepensBreachedLimit(floor(630), floor(660))).toBe(false);
		expect(deepensBreachedLimit(floor(630), floor(630))).toBe(false);
		// A floor reached is no breach, however it got there.
		expect(deepensBreachedLimit(floor(800), floor(720))).toBe(false);
	});

	it("judges a floor rising above itself by the after limit, not a ceiling", () => {
		// Read as a ceiling, 900 > 720 and 900 > 630 would count as deeper.
		expect(
			deepensBreachedLimit(
				of({ used: minutes(630), limit: minutes(720), limitDirection: "floor" }),
				of({ used: minutes(900), limit: minutes(720), limitDirection: "floor" }),
			),
		).toBe(false);
	});

	it("treats a summary without limitDirection as a ceiling", () => {
		const after = of({ used: minutes(600), limit: minutes(720) });
		expect(deepensBreachedLimit(of({ used: minutes(630), limit: minutes(720) }), after)).toBe(
			false,
		);
		expect(
			deepensBreachedLimit(
				of({ used: minutes(800), limit: minutes(720) }),
				of({ used: minutes(900), limit: minutes(720) }),
			),
		).toBe(true);
	});

	it("never compares quantities of different units or missing quantities", () => {
		expect(
			deepensBreachedLimit(
				of({ used: days(1), limit: days(0) }),
				of({ used: minutes(300), limit: minutes(0) }),
			),
		).toBe(false);
		expect(
			deepensBreachedLimit(
				of({ used: minutes(2_460), limit: minutes(2_400) }),
				of({ used: minutes(2_520), limit: days(5) }),
			),
		).toBe(false);
		expect(deepensBreachedLimit(of({ tier: "exceeded" }), of({ tier: "exceeded" }))).toBe(false);
	});
});

describe("limitDirection reaches Scheduling and restricted readers", () => {
	const finding = (summary: StatutoryFindingSummary): StatutoryFinding => ({
		id: "jarbschg_rest_period:e1:shift:s1",
		organizationId: "o1",
		employeeId: "e1",
		domain: "youth_protection",
		kind: "jarbschg_rest_period",
		severity: "critical",
		subjectKey: "shift:s1",
		periodStart: "2027-03-02",
		periodEnd: "2027-03-03",
		legalReference: "§ 13 JArbSchG",
		summary,
		adminDetail: null,
		inputFingerprint: "v1:test",
		acknowledgementKind: null,
		blocksPublication: true,
	});

	it("keeps a floor through restrictedSummary and the Scheduling projection", () => {
		const rest = finding({
			tier: "exceeded",
			used: minutes(630),
			limit: minutes(720),
			limitDirection: "floor",
		});
		expect(restrictedSummary(rest)).toEqual({
			tier: "exceeded",
			used: minutes(630),
			limit: minutes(720),
			limitDirection: "floor",
		});
		expect(toStatutoryComplianceFinding(rest).summary.limitDirection).toBe("floor");
	});

	it("keeps an explicit ceiling and adds none when the monitor gave none", () => {
		expect(
			toStatutoryComplianceFinding(
				finding({ used: minutes(540), limit: minutes(480), limitDirection: "ceiling" }),
			).summary.limitDirection,
		).toBe("ceiling");
		expect(
			"limitDirection" in
				toStatutoryComplianceFinding(finding({ used: minutes(540), limit: minutes(480) })).summary,
		).toBe(false);
	});
});

import { describe, expect, it } from "vitest";
import type { StatutoryFinding, StatutoryFindingSummary } from "../finding";
import { youthBreachScopeOf } from "../youth/youth-findings";
import { causedBlockingFindings } from "./caused-blocking";
import { deepensBreachedLimit } from "./evaluate";

const minutes = (value: number) => ({ unit: "minutes" as const, value });
const days = (value: number) => ({ unit: "days" as const, value });

/** A blocking youth breach of `kind` on `shiftId`, judged on `day`. */
function breach(
	kind: string,
	shiftId: string,
	day: string,
	summary: StatutoryFindingSummary = { tier: "exceeded" },
	overrides: Partial<StatutoryFinding> = {},
): StatutoryFinding {
	return {
		id: `${kind}:e1:shift:${shiftId}`,
		organizationId: "o1",
		employeeId: "e1",
		domain: kind.startsWith("bbig_") ? "apprenticeship" : "youth_protection",
		kind,
		severity: "critical",
		subjectKey: `shift:${shiftId}`,
		periodStart: day,
		periodEnd: day,
		legalReference: "§ JArbSchG",
		summary,
		adminDetail: null,
		inputFingerprint: `v1:${kind}:${shiftId}:${day}`,
		acknowledgementKind: null,
		blocksPublication: true,
		...overrides,
	};
}

const sixDays = (used = 6) => ({ tier: "exceeded" as const, used: days(used), limit: days(5) });
const week = (used: number) => ({
	tier: "exceeded" as const,
	used: minutes(used),
	limit: minutes(2_400),
});
const day = (used: number) => ({
	tier: "exceeded" as const,
	used: minutes(used),
	limit: minutes(480),
});
const rest = (used: number) => ({
	tier: "exceeded" as const,
	used: minutes(used),
	limit: minutes(720),
	limitDirection: "floor" as const,
});

const kinds = (findings: readonly StatutoryFinding[]) => findings.map((finding) => finding.kind);

describe("youthBreachScopeOf", () => {
	const scope = (kind: string, periodStart: string, employeeId = "e1") =>
		youthBreachScopeOf({ kind, employeeId, periodStart });

	it("scopes the weekly rules to the compliance week, Monday to Sunday", () => {
		expect(scope("jarbschg_days_per_week", "2027-03-01")).toBe(
			scope("jarbschg_days_per_week", "2027-03-07"),
		);
		expect(scope("jarbschg_days_per_week", "2027-03-07")).not.toBe(
			scope("jarbschg_days_per_week", "2027-03-08"),
		);
		expect(scope("jarbschg_weekly_max", "2027-03-05")).not.toBe(
			scope("jarbschg_weekly_max", "2027-03-12"),
		);
	});

	it("scopes the rest period and the daily maximum to the judged day", () => {
		expect(scope("jarbschg_rest_period", "2027-03-02")).not.toBe(
			scope("jarbschg_rest_period", "2027-03-04"),
		);
		expect(scope("jarbschg_daily_max", "2027-03-02")).toBe(
			scope("jarbschg_daily_max", "2027-03-02"),
		);
	});

	it("keeps rules and employees apart", () => {
		expect(scope("jarbschg_daily_max", "2027-03-02")).not.toBe(
			scope("jarbschg_weekly_max", "2027-03-02"),
		);
		expect(scope("jarbschg_daily_max", "2027-03-02")).not.toBe(
			scope("jarbschg_daily_max", "2027-03-02", "e2"),
		);
	});

	it("has no position scope for findings about their own work", () => {
		expect(scope("jarbschg_night_work", "2027-03-02")).toBeNull();
		expect(scope("jarbschg_holiday_prohibited", "2026-12-24")).toBeNull();
		expect(scope("bbig_release_day_shift", "2027-03-02")).toBeNull();
	});
});

describe("deepensBreachedLimit against several priors", () => {
	it("is deeper than the deepest prior only when deeper than each of them", () => {
		const priors = [{ summary: day(540) }, { summary: day(600) }];
		const deeper = (used: number) =>
			priors.every((prior) => deepensBreachedLimit(prior, { summary: day(used) }));
		expect(deeper(570)).toBe(false);
		expect(deeper(600)).toBe(false);
		expect(deeper(630)).toBe(true);
	});

	it("is never deeper than a prior without figures", () => {
		expect(deepensBreachedLimit({ summary: { tier: "exceeded" } }, { summary: day(600) })).toBe(
			false,
		);
	});
});

describe("causedBlockingFindings", () => {
	describe("a breach attributed by position", () => {
		it("is caused when the shift carries it into another week, at the same figures", () => {
			// X was the sixth day of week 1 and is moved to the sixth day of week 2.
			const before = [breach("jarbschg_days_per_week", "x", "2027-03-06", sixDays())];
			const after = [breach("jarbschg_days_per_week", "x", "2027-03-13", sixDays())];
			expect(kinds(causedBlockingFindings(before, after))).toEqual(["jarbschg_days_per_week"]);
		});

		it("is caused when a weekly maximum moves across the week boundary, even shorter", () => {
			const before = [breach("jarbschg_weekly_max", "x", "2027-03-05", week(2_460))];
			const after = [breach("jarbschg_weekly_max", "x", "2027-03-12", week(2_430))];
			expect(kinds(causedBlockingFindings(before, after))).toEqual(["jarbschg_weekly_max"]);
		});

		it("is caused when a rest breach moves to another day, at the same rest", () => {
			const before = [breach("jarbschg_rest_period", "x", "2027-03-02", rest(660))];
			const after = [breach("jarbschg_rest_period", "x", "2027-03-04", rest(660))];
			expect(kinds(causedBlockingFindings(before, after))).toEqual(["jarbschg_rest_period"]);
		});

		it("ignores an id-matched prior in another scope that would hide a deepening here", () => {
			// Thursday had 9 h (Y); X, once 11 h on Tuesday, moves there and makes Thursday 10 h.
			const before = [
				breach("jarbschg_daily_max", "x", "2027-03-02", day(660)),
				breach("jarbschg_daily_max", "y", "2027-03-04", day(540)),
			];
			const after = [breach("jarbschg_daily_max", "x", "2027-03-04", day(600))];
			expect(kinds(causedBlockingFindings(before, after))).toEqual(["jarbschg_daily_max"]);
		});

		it("is not caused when it stays in its scope on another shift, no deeper", () => {
			const before = [breach("jarbschg_rest_period", "early", "2027-03-02", rest(660))];
			const after = [breach("jarbschg_rest_period", "later", "2027-03-02", rest(705))];
			expect(causedBlockingFindings(before, after)).toEqual([]);
		});

		it("compares a scope with several priors against its deepest one", () => {
			// Two pieces past the cap on Tuesday, both reporting the day's total.
			const before = [
				breach("jarbschg_daily_max", "a", "2027-03-02", day(540)),
				breach("jarbschg_daily_max", "b", "2027-03-02", day(600)),
			];
			const noDeeper = [breach("jarbschg_daily_max", "a", "2027-03-02", day(600))];
			const deeper = [breach("jarbschg_daily_max", "c", "2027-03-02", day(630))];
			expect(causedBlockingFindings(before, noDeeper)).toEqual([]);
			expect(kinds(causedBlockingFindings(before, deeper))).toEqual(["jarbschg_daily_max"]);
		});
	});

	describe("a breach about its own work", () => {
		it("is the same breach on the same day, caused only when deeper", () => {
			const night = (used: number) => ({
				tier: "exceeded" as const,
				used: minutes(used),
				limit: minutes(0),
			});
			const before = [breach("jarbschg_night_work", "x", "2027-03-02", night(60))];
			expect(
				causedBlockingFindings(before, [
					breach("jarbschg_night_work", "x", "2027-03-02", night(60)),
				]),
			).toEqual([]);
			expect(
				kinds(
					causedBlockingFindings(before, [
						breach("jarbschg_night_work", "x", "2027-03-02", night(90)),
					]),
				),
			).toEqual(["jarbschg_night_work"]);
		});

		it("is caused when its shift moves it to another day", () => {
			const before = [breach("jarbschg_night_work", "x", "2027-03-02")];
			const after = [breach("jarbschg_night_work", "x", "2027-03-03")];
			expect(kinds(causedBlockingFindings(before, after))).toEqual(["jarbschg_night_work"]);
		});

		it("does not take another shift's breach that day as its own", () => {
			const before = [breach("jarbschg_holiday_prohibited", "y", "2026-12-24")];
			const after = [breach("jarbschg_holiday_prohibited", "x", "2026-12-24")];
			expect(kinds(causedBlockingFindings(before, after))).toEqual(["jarbschg_holiday_prohibited"]);
		});
	});

	describe("an apprentice release conflict", () => {
		it("is caused on a release day that had none, though the shift had one elsewhere", () => {
			const before = [breach("bbig_release_day_shift", "x", "2027-03-02")];
			const after = [breach("bbig_release_day_shift", "x", "2027-03-04")];
			expect(kinds(causedBlockingFindings(before, after))).toEqual(["bbig_release_day_shift"]);
		});

		it("is not caused on a release day that already had one", () => {
			const before = [breach("bbig_release_day_shift", "x", "2027-03-02")];
			expect(
				causedBlockingFindings(before, [breach("bbig_release_day_shift", "x", "2027-03-02")]),
			).toEqual([]);
			expect(
				causedBlockingFindings(before, [breach("bbig_release_day_shift", "y", "2027-03-02")]),
			).toEqual([]);
		});

		describe("of a night shift running into the release day", () => {
			// The contributor dates a conflict by its release day: Wednesday's, for Tuesday 22:00–02:00.
			const overnight = breach("bbig_release_day_shift", "night", "2027-03-03");

			it("shares the release day's scope, not the day the shift starts on", () => {
				// Tuesday's lessons conflict with a moved shift: a new conflict on Tuesday's release.
				const tuesdayLessons = breach("bbig_release_day_shift", "moved", "2027-03-02");
				expect(kinds(causedBlockingFindings([overnight], [overnight, tuesdayLessons]))).toEqual([
					"bbig_release_day_shift",
				]);
			});

			it("is not caused when a shift moves overnight into the release day it conflicted with", () => {
				// Wednesday 08:00 moved to Tuesday 22:00: still Wednesday's release.
				const before = [breach("bbig_release_day_shift", "x", "2027-03-03")];
				expect(causedBlockingFindings(before, [overnight])).toEqual([]);
			});
		});

		it("keeps another employee's release day apart", () => {
			const before = [breach("bbig_release_day_shift", "x", "2027-03-02")];
			const after = [
				breach("bbig_release_day_shift", "y", "2027-03-02", undefined, {
					id: "bbig_release_day_shift:e2:shift:y",
					employeeId: "e2",
				}),
			];
			expect(kinds(causedBlockingFindings(before, after))).toEqual(["bbig_release_day_shift"]);
		});
	});

	describe("a sector-exception breach (night, Saturday, Sunday, holiday work)", () => {
		const oneDay = { tier: "exceeded" as const, used: days(1), limit: days(0) };
		const saturday = (shiftId: string, coveredMinutes: number, overrides = {}) =>
			breach("jarbschg_saturday_work", shiftId, "2027-03-06", oneDay, {
				coveredMinutes,
				...overrides,
			});
		/** Before the edit: blocking, but lifted by its current acknowledgement. */
		const acknowledged = (coveredMinutes: number) =>
			saturday("x", coveredMinutes, { blocksPublication: false, publicationBlockLifted: true });

		it("counts an acknowledged breach as a prior: an edit that eases it is not caused", () => {
			// 10:00–14:00 acknowledged, shortened to 10:00–13:00: the acknowledgement goes stale.
			expect(causedBlockingFindings([acknowledged(240)], [saturday("x", 180)])).toEqual([]);
		});

		it("is caused when the edit covers more work than before, acknowledged or not", () => {
			// 10:00–14:00 extended to 10:00–16:00: still one Saturday, two more hours of it.
			expect(kinds(causedBlockingFindings([acknowledged(240)], [saturday("x", 360)]))).toEqual([
				"jarbschg_saturday_work",
			]);
			expect(kinds(causedBlockingFindings([saturday("x", 240)], [saturday("x", 360)]))).toEqual([
				"jarbschg_saturday_work",
			]);
		});

		it("is caused for another employee: their breach has no prior", () => {
			const reassigned = saturday("x", 240, {
				id: "jarbschg_saturday_work:e2:shift:x",
				employeeId: "e2",
			});
			expect(kinds(causedBlockingFindings([acknowledged(240)], [reassigned]))).toEqual([
				"jarbschg_saturday_work",
			]);
		});
	});

	it("only counts blocking priors of the same severity and tier", () => {
		const before = [
			breach("jarbschg_daily_max", "x", "2027-03-02", day(600), { blocksPublication: false }),
		];
		const after = [breach("jarbschg_daily_max", "x", "2027-03-02", day(600))];
		expect(kinds(causedBlockingFindings(before, after))).toEqual(["jarbschg_daily_max"]);
	});

	it("never reports a finding that does not block publication", () => {
		const after = [
			breach("jarbschg_daily_max", "x", "2027-03-02", day(600), { blocksPublication: false }),
		];
		expect(causedBlockingFindings([], after)).toEqual([]);
	});
});

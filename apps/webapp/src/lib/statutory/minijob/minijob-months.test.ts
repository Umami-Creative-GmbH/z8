import { describe, expect, it } from "vitest";
import { DEFAULT_STATUTORY_PREFERENCES } from "../preferences";
import {
	computeMinijobMonths,
	judgeMinijobMonths,
	type MinijobMonthFacts,
	monthsBetween,
} from "./minijob-months";

/** A Minijob month earning `cents` from one work item at 10 € an hour. */
function month(
	key: string,
	cents: number,
	baseline: Pick<
		MinijobMonthFacts,
		"capCents" | "unforeseeableMultiplier" | "maxUnforeseeableMonths"
	>,
): MinijobMonthFacts {
	return {
		month: key,
		isMinijob: true,
		...baseline,
		items:
			cents > 0
				? [
						{
							source: "work",
							id: `w-${key}`,
							date: `${key}-02`,
							minutes: (cents * 60) / 1000,
							hourlyRateCents: 1000,
						},
					]
				: [],
		shifts: [],
		externalOffsets: [],
	};
}

const statuses = (facts: MinijobMonthFacts[], acknowledged: Set<string>) =>
	judgeMinijobMonths(
		computeMinijobMonths("e1", facts),
		(m) => (acknowledged.has(m.month) ? "current" : "none"),
		DEFAULT_STATUTORY_PREFERENCES,
	)
		.filter((m) => m.exceedance)
		.map((m) => [m.month, m.exceedance?.status]);

describe("Minijob month judgement (#1989)", () => {
	it("applies the allowance in force each month: three months and no multiplier before October 2022", () => {
		const before = { capCents: 45_000, unforeseeableMultiplier: null, maxUnforeseeableMonths: 3 };
		const months = monthsBetween("2022-01", "2022-05").map((key) => month(key, 150_000, before));

		// 1,500 € is far above twice 450 €, but the old rule had no multiplier.
		expect(statuses(months, new Set(["2022-01", "2022-02", "2022-03", "2022-04"]))).toEqual([
			["2022-01", "acknowledged"],
			["2022-02", "acknowledged"],
			["2022-03", "acknowledged"],
			["2022-04", "too_many_exceedances"],
		]);
	});

	it("forgets an exceedance once it leaves the 12 months", () => {
		const now = { capCents: 60_300, unforeseeableMultiplier: 2, maxUnforeseeableMonths: 2 };
		const months = monthsBetween("2026-01", "2027-02").map((key) =>
			month(key, ["2026-01", "2026-02", "2027-01"].includes(key) ? 70_000 : 0, now),
		);

		// January 2027 looks back to February 2026: one earlier exceedance.
		expect(statuses(months, new Set(["2026-01", "2026-02", "2027-01"]))).toEqual([
			["2026-01", "acknowledged"],
			["2026-02", "acknowledged"],
			["2027-01", "acknowledged"],
		]);
	});

	it("lets an acknowledged exceedance reach exactly twice the cap, but not a cent more", () => {
		const now = { capCents: 60_300, unforeseeableMultiplier: 2, maxUnforeseeableMonths: 2 };
		const atDouble = month("2026-03", 120_600, now);
		const aboveDouble = month("2026-04", 120_601, now);

		expect(statuses([atDouble, aboveDouble], new Set(["2026-03", "2026-04"]))).toEqual([
			["2026-03", "acknowledged"],
			["2026-04", "over_double_cap"],
		]);
	});

	it("does not judge months without a baseline", () => {
		const [judged] = judgeMinijobMonths(
			computeMinijobMonths("e1", [
				month("2012-06", 90_000, {
					capCents: null,
					unforeseeableMultiplier: null,
					maxUnforeseeableMonths: null,
				}),
			]),
			() => "none",
			DEFAULT_STATUTORY_PREFERENCES,
		);

		expect(judged).toMatchObject({
			usage: null,
			exceedance: null,
			rolling: null,
			totalCents: 90_000,
		});
	});
});

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

	describe("acknowledgement fingerprint of a month with shifts", () => {
		const baseline = { capCents: 60_300, unforeseeableMultiplier: 2, maxUnforeseeableMonths: 2 };
		/** December: eight 10 h shifts from the 1st, at 10 € an hour. */
		const shifts = Array.from({ length: 8 }, (_, i) => ({
			id: `s${i + 1}`,
			date: `2026-12-0${i + 1}`,
			minutes: 600,
			hourlyRateCents: 1000,
		}));
		const planned = (from: number) =>
			shifts.slice(from).map((shift) => ({ source: "shift" as const, ...shift }));
		const worked = (shiftIds: string[], date: string, minutes: number, id = `w-${date}`) => ({
			source: "work" as const,
			id,
			date,
			minutes,
			hourlyRateCents: 1000,
			shiftIds,
		});
		const fingerprintOf = (items: MinijobMonthFacts["items"]) =>
			computeMinijobMonths("e1", [
				{
					month: "2026-12",
					isMinijob: true,
					...baseline,
					items,
					shifts,
					externalOffsets: [],
				},
			])[0]?.fingerprint;

		it("stays current while a shift is worked as planned", () => {
			const acknowledged = fingerprintOf(planned(0));

			expect(fingerprintOf([worked(["s1"], "2026-12-01", 600), ...planned(1)])).toBe(acknowledged);
			// A few minutes over the plan are not material.
			expect(fingerprintOf([worked(["s1"], "2026-12-01", 610), ...planned(1)])).toBe(acknowledged);
		});

		it("goes stale on extra work although an earlier shift was missed", () => {
			// The 1 December shift was never worked: the admin acknowledged the 700 € left.
			const acknowledged = fingerprintOf(planned(1));

			// 18 h on the 10 h shift of 2 December: 780 €.
			expect(fingerprintOf([worked(["s2"], "2026-12-02", 1080), ...planned(2)])).not.toBe(
				acknowledged,
			);
		});

		it("goes stale on an overrun after a short shift", () => {
			const acknowledged = fingerprintOf([worked(["s1"], "2026-12-01", 300), ...planned(1)]);

			// 1 December was cut to 5 h; 2 December ran 5 h over.
			expect(
				fingerprintOf([
					worked(["s1"], "2026-12-01", 300),
					worked(["s2"], "2026-12-02", 900),
					...planned(2),
				]),
			).not.toBe(acknowledged);
		});

		it("can keep an acknowledgement current while the month crosses twice the cap", () => {
			const facts = (minutes: number): MinijobMonthFacts => ({
				month: "2026-12",
				isMinijob: true,
				...baseline,
				// Twice the cap is 800 €: exactly what the eight shifts earn.
				capCents: 40_000,
				items: [worked(["s1"], "2026-12-01", minutes), ...planned(1)],
				shifts,
				externalOffsets: [],
			});
			const [acknowledged] = computeMinijobMonths("e1", [facts(600)]);
			// Ten minutes over the first shift: immaterial for the fingerprint, but above twice the cap.
			const later = computeMinijobMonths("e1", [facts(610)]);

			const [judged] = judgeMinijobMonths(
				later,
				(m) => (m.fingerprint === acknowledged?.fingerprint ? "current" : "none"),
				DEFAULT_STATUTORY_PREFERENCES,
			);
			expect(judged?.exceedance?.status).toBe("over_double_cap");
			expect(judged?.fingerprint).toBe(acknowledged?.fingerprint);
		});

		it("goes stale when open work outside any shift grows materially, not minute by minute", () => {
			const unplanned = (minutes: number, inProgress: boolean) => ({
				source: "work" as const,
				id: "w-open",
				date: "2026-12-09",
				minutes,
				hourlyRateCents: 1000,
				...(inProgress ? { inProgress: true } : {}),
			});
			const acknowledged = fingerprintOf([...planned(0), unplanned(60, true)]);

			// A few more minutes, and the clock-out at the same time, change nothing material.
			expect(fingerprintOf([...planned(0), unplanned(70, true)])).toBe(acknowledged);
			expect(fingerprintOf([...planned(0), unplanned(70, false)])).toBe(acknowledged);
			// 25 more hours on the same open clock-in is new work the admin never saw.
			expect(fingerprintOf([...planned(0), unplanned(60 + 25 * 60, true)])).not.toBe(acknowledged);
		});

		it("nets one clock-in over back-to-back shifts against both", () => {
			const acknowledged = fingerprintOf(planned(0));

			expect(fingerprintOf([worked(["s1", "s2"], "2026-12-01", 1200), ...planned(2)])).toBe(
				acknowledged,
			);
		});
	});

	it("prices the month's minutes once, however they split between work and plan", () => {
		const totalOf = (workMinutes: number, restMinutes: number) =>
			computeMinijobMonths("e1", [
				{
					...month("2026-12", 0, {
						capCents: 60_300,
						unforeseeableMultiplier: 2,
						maxUnforeseeableMonths: 2,
					}),
					// 12.50 € an hour: 20.83 ct a minute.
					items: [
						{
							source: "work",
							id: "w",
							date: "2026-12-01",
							minutes: workMinutes,
							hourlyRateCents: 1250,
						},
						{
							source: "shift",
							id: "s",
							date: "2026-12-01",
							minutes: restMinutes,
							hourlyRateCents: 1250,
						},
					],
				},
			])[0]?.totalCents;

		// Four minutes: 83.33 ct.
		expect(totalOf(2, 2)).toBe(83);
		expect(totalOf(4, 0)).toBe(83);
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

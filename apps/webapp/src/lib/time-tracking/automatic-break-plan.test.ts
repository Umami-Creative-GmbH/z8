import { describe, expect, it } from "vitest";
import { instantToCanonicalString, parseInstant } from "@/lib/datetime/temporal-core";
import { breakMinutesTakenBefore, planAutomaticBreak } from "./automatic-break-plan";

const at = (value: string) => parseInstant(value);
const iso = (value: Parameters<typeof instantToCanonicalString>[0]) =>
	instantToCanonicalString(value);

const regulation = {
	id: "00000000-0000-4000-8000-000000000001",
	name: "ArbZG",
	maxUninterruptedMinutes: null,
	breakRules: [
		{ workingMinutesThreshold: 360, requiredBreakMinutes: 30 },
		{ workingMinutesThreshold: 540, requiredBreakMinutes: 45 },
	],
};

describe("breakMinutesTakenBefore", () => {
	it("sums whole-minute gaps over one minute between the day's work up to the source end", () => {
		expect(
			breakMinutesTakenBefore(
				[
					{ startAt: at("2026-07-22T06:00:00Z"), endAt: at("2026-07-22T07:00:00Z") },
					{ startAt: at("2026-07-22T07:01:00Z"), endAt: at("2026-07-22T07:30:00Z") },
					{ startAt: at("2026-07-22T07:40:30Z"), endAt: at("2026-07-22T15:00:00Z") },
					{ startAt: at("2026-07-22T16:00:00Z"), endAt: at("2026-07-22T17:00:00Z") },
				],
				at("2026-07-22T15:00:00Z"),
			),
		).toBe(10);
	});

	it("does not count time covered by overlapping work as a break", () => {
		expect(
			breakMinutesTakenBefore(
				[
					{ startAt: at("2026-07-22T06:00:00Z"), endAt: at("2026-07-22T09:00:00Z") },
					{ startAt: at("2026-07-22T07:00:00Z"), endAt: at("2026-07-22T08:00:00Z") },
					{ startAt: at("2026-07-22T09:20:00Z"), endAt: at("2026-07-22T12:00:00Z") },
				],
				at("2026-07-22T12:00:00Z"),
			),
		).toBe(20);
	});

	it("is independent of the input order", () => {
		const periods = [
			{ startAt: at("2026-07-22T09:20:00Z"), endAt: at("2026-07-22T12:00:00Z") },
			{ startAt: at("2026-07-22T06:00:00Z"), endAt: at("2026-07-22T09:00:00Z") },
		];
		expect(breakMinutesTakenBefore(periods, at("2026-07-22T12:00:00Z"))).toBe(20);
	});
});

describe("planAutomaticBreak", () => {
	const source = {
		sourceStart: at("2026-07-22T06:00:40Z"),
		sourceEnd: at("2026-07-22T13:00:31Z"),
		sourceDurationMinutes: 420,
	};

	it("returns null without a regulation, below every threshold or once the break was taken", () => {
		expect(planAutomaticBreak({ ...source, alreadyTakenBreakMinutes: 0, regulation: null })).toBe(
			null,
		);
		expect(
			planAutomaticBreak({
				...source,
				sourceDurationMinutes: 360,
				alreadyTakenBreakMinutes: 0,
				regulation,
			}),
		).toBe(null);
		expect(planAutomaticBreak({ ...source, alreadyTakenBreakMinutes: 30, regulation })).toBe(null);
	});

	it("inserts the owed break after the threshold and rounds each segment on its own", () => {
		const plan = planAutomaticBreak({ ...source, alreadyTakenBreakMinutes: 10, regulation });
		expect(plan).not.toBe(null);
		if (!plan) return;
		expect(plan.breakMinutes).toBe(20);
		expect(plan.rule).toEqual({ workingMinutesThreshold: 360, requiredBreakMinutes: 30 });
		expect(plan.regulation).toEqual({ id: regulation.id, name: "ArbZG" });
		expect(iso(plan.breakStartAt)).toBe("2026-07-22T12:00:40Z");
		expect(iso(plan.breakEndAt)).toBe("2026-07-22T12:20:40Z");
		// 06:00:40-12:00:40 is 360 min; 12:20:40-13:00:31 is 39m51s, half up 40.
		expect(plan.retainedMinutes).toBe(360);
		expect(plan.generatedMinutes).toBe(40);
	});

	it("places the break after the maximum uninterrupted time when that comes first", () => {
		const plan = planAutomaticBreak({
			...source,
			alreadyTakenBreakMinutes: 0,
			regulation: { ...regulation, maxUninterruptedMinutes: 300 },
		});
		expect(plan && iso(plan.breakStartAt)).toBe("2026-07-22T11:00:40Z");
		expect(plan && iso(plan.breakEndAt)).toBe("2026-07-22T11:30:40Z");
	});

	it("keeps a positive segment that rounds to zero minutes", () => {
		const plan = planAutomaticBreak({
			sourceStart: at("2026-07-22T06:00:00Z"),
			sourceEnd: at("2026-07-22T12:30:20Z"),
			sourceDurationMinutes: 390,
			alreadyTakenBreakMinutes: 0,
			regulation,
		});
		expect(plan?.retainedMinutes).toBe(360);
		expect(plan?.generatedMinutes).toBe(0);
	});

	it("returns null when the break does not end strictly inside the work", () => {
		expect(
			planAutomaticBreak({
				sourceStart: at("2026-07-22T06:00:00Z"),
				sourceEnd: at("2026-07-22T12:30:00Z"),
				sourceDurationMinutes: 390,
				alreadyTakenBreakMinutes: 0,
				regulation,
			}),
		).toBe(null);
	});
});

import { describe, expect, it } from "vitest";
import type { StatutoryFinding } from "../finding";
import { statutoryBreachDepth } from "./finding-key";

type DepthInput = Parameters<typeof statutoryBreachDepth>[0];

const minutes = (value: number) => ({ unit: "minutes" as const, value });

function weekly(used: number, limit: number, extra: Partial<StatutoryFinding> = {}): DepthInput {
	return {
		domain: "working_student",
		summary: {
			tier: used > limit ? "exceeded" : "warning",
			used: minutes(used),
			limit: minutes(limit),
		},
		...extra,
	};
}

describe("statutoryBreachDepth", () => {
	it("counts a ceiling breach by how far it goes", () => {
		expect(statutoryBreachDepth(weekly(1_320, 1_200))).toEqual({
			used: 1_320,
			limit: 1_200,
			coveredMinutes: null,
		});
		expect(statutoryBreachDepth(weekly(1_800, 1_200))).not.toEqual(
			statutoryBreachDepth(weekly(1_320, 1_200)),
		);
	});

	it("counts a floor breach (a short rest) by how far below it goes", () => {
		const rest = (used: number): DepthInput => ({
			domain: "youth_protection",
			summary: {
				tier: "exceeded",
				used: minutes(used),
				limit: minutes(720),
				limitDirection: "floor",
			},
		});
		expect(statutoryBreachDepth(rest(600))).toEqual({
			used: 600,
			limit: 720,
			coveredMinutes: null,
		});
		expect(statutoryBreachDepth(rest(800))).toBeNull();
	});

	it("ignores the figures of a finding within its limit: its tier says enough", () => {
		expect(statutoryBreachDepth(weekly(1_100, 1_200))).toBeNull();
		expect(statutoryBreachDepth(weekly(1_101, 1_200))).toBeNull();
	});

	it("counts an earnings-derived finding by its tier alone, so no hash confirms a wage", () => {
		expect(statutoryBreachDepth(weekly(1_320, 1_200, { earningsDerived: true }))).toBeNull();
		expect(
			statutoryBreachDepth({
				domain: "minijob",
				summary: { tier: "exceeded", used: minutes(2_000), limit: minutes(1_000) },
			}),
		).toBeNull();
	});

	it("counts the work a sector exception or release conflict covers", () => {
		expect(
			statutoryBreachDepth({
				domain: "apprenticeship",
				summary: { tier: "exceeded" },
				coveredMinutes: 90,
			}),
		).toEqual({ used: null, limit: null, coveredMinutes: 90 });
	});

	it("counts a running clock-in without the minutes it grows by", () => {
		const running = (used: number) => weekly(used, 1_200, { stableDepth: { used: 1_250 } });
		expect(statutoryBreachDepth(running(1_320))).toEqual({
			used: 1_250,
			limit: 1_200,
			coveredMinutes: null,
		});
		expect(statutoryBreachDepth(running(1_321))).toEqual(statutoryBreachDepth(running(1_320)));
		// Once clocked out the minutes are fixed: the visible depth counts.
		expect(statutoryBreachDepth(weekly(1_250, 1_200))).toEqual(
			statutoryBreachDepth(running(1_320)),
		);
		// Breached only by the running work: steady until the clock-out.
		expect(
			statutoryBreachDepth(
				weekly(1_210, 1_200, { stableDepth: { used: null, coveredMinutes: null } }),
			),
		).toEqual({ used: null, limit: 1_200, coveredMinutes: null });
	});
});

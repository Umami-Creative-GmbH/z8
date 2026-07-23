import { describe, expect, it } from "vitest";
import { calculateBreakDeficit } from "./break-policy-calculation";

const regulation = {
	id: "policy-1",
	name: "German working time",
	maxUninterruptedMinutes: 360,
	breakRules: [
		{ workingMinutesThreshold: 360, requiredBreakMinutes: 30 },
		{ workingMinutesThreshold: 540, requiredBreakMinutes: 45 },
	],
};

describe("calculateBreakDeficit", () => {
	it("applies a rule only above its threshold and chooses the highest applicable rule", () => {
		expect(
			calculateBreakDeficit({
				sessionDurationMinutes: 540,
				alreadyTakenBreakMinutes: 0,
				regulation,
			}),
		).toMatchObject({
			deficit: 30,
			applicableRule: regulation.breakRules[0],
		});
		expect(
			calculateBreakDeficit({
				sessionDurationMinutes: 541,
				alreadyTakenBreakMinutes: 0,
				regulation,
			}),
		).toMatchObject({
			deficit: 45,
			applicableRule: regulation.breakRules[1],
		});
	});

	it("subtracts already-taken breaks without returning a negative deficit", () => {
		expect(
			calculateBreakDeficit({
				sessionDurationMinutes: 541,
				alreadyTakenBreakMinutes: 30,
				regulation,
			}).deficit,
		).toBe(15);
		expect(
			calculateBreakDeficit({
				sessionDurationMinutes: 541,
				alreadyTakenBreakMinutes: 60,
				regulation,
			}).deficit,
		).toBe(0);
	});

	it("returns deterministic empty evidence without a regulation or applicable rule", () => {
		expect(
			calculateBreakDeficit({
				sessionDurationMinutes: 600,
				alreadyTakenBreakMinutes: 0,
				regulation: null,
			}),
		).toEqual({
			deficit: 0,
			applicableRule: null,
			regulationId: null,
			regulationName: null,
			maxUninterruptedMinutes: null,
		});
		expect(
			calculateBreakDeficit({
				sessionDurationMinutes: 360,
				alreadyTakenBreakMinutes: 0,
				regulation,
			}),
		).toEqual({
			deficit: 0,
			applicableRule: null,
			regulationId: regulation.id,
			regulationName: regulation.name,
			maxUninterruptedMinutes: regulation.maxUninterruptedMinutes,
		});
	});
});

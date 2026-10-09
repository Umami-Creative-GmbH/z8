import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { type BreakDueInput, breakDueStatus } from "./break-due";

const at = parseInstant;

function input(overrides: Partial<BreakDueInput>): BreakDueInput {
	return {
		regulation: { maxUninterruptedMinutes: 360, breakRules: [] },
		completedMinutes: 0,
		breakMinutes: 0,
		liveStart: at("2026-04-28T06:00:00Z"),
		now: at("2026-04-28T10:00:00Z"),
		...overrides,
	};
}

describe("when the break rules are broken without a break", () => {
	it("breaks the uninterrupted-work limit once the live work has run that long", () => {
		const status = breakDueStatus(input({}));
		expect(status.breaches).toEqual([
			{ rule: { kind: "max_uninterrupted", limitMinutes: 360 }, at: at("2026-04-28T12:00:00Z") },
		]);
		expect(status.uninterruptedMinutes).toBe(240);
		expect(status.minutesUntilUninterruptedLimit).toBe(120);
	});

	it("breaks a threshold rule when the day's work reaches its threshold, counting earlier work", () => {
		// 2 h worked earlier today with a 20 min break; 30 min are needed after 6 h of work.
		const status = breakDueStatus(
			input({
				regulation: {
					maxUninterruptedMinutes: null,
					breakRules: [{ workingMinutesThreshold: 360, requiredBreakMinutes: 30 }],
				},
				completedMinutes: 120,
				breakMinutes: 20,
			}),
		);
		expect(status.breaches).toEqual([
			{
				rule: { kind: "break_rule", workingMinutesThreshold: 360, requiredBreakMinutes: 30 },
				at: at("2026-04-28T10:00:00Z"),
			},
		]);
		expect(status.minutesUntilUninterruptedLimit).toBeNull();
	});

	it("does not break a threshold rule the day's breaks already meet", () => {
		const status = breakDueStatus(
			input({
				regulation: {
					maxUninterruptedMinutes: null,
					breakRules: [
						{ workingMinutesThreshold: 360, requiredBreakMinutes: 30 },
						{ workingMinutesThreshold: 540, requiredBreakMinutes: 45 },
					],
				},
				completedMinutes: 240,
				breakMinutes: 30,
			}),
		);
		expect(status.breaches.map((breach) => breach.rule)).toEqual([
			{ kind: "break_rule", workingMinutesThreshold: 540, requiredBreakMinutes: 45 },
		]);
		expect(status.breaches[0].at).toEqual(at("2026-04-28T11:00:00Z"));
	});

	it("lists breaches earliest first, the uninterrupted limit before a rule due at the same time", () => {
		const status = breakDueStatus(
			input({
				regulation: {
					maxUninterruptedMinutes: 360,
					breakRules: [
						{ workingMinutesThreshold: 540, requiredBreakMinutes: 45 },
						{ workingMinutesThreshold: 360, requiredBreakMinutes: 30 },
					],
				},
			}),
		);
		expect(status.breaches).toEqual([
			{ rule: { kind: "max_uninterrupted", limitMinutes: 360 }, at: at("2026-04-28T12:00:00Z") },
			{
				rule: { kind: "break_rule", workingMinutesThreshold: 360, requiredBreakMinutes: 30 },
				at: at("2026-04-28T12:00:00Z"),
			},
			{
				rule: { kind: "break_rule", workingMinutesThreshold: 540, requiredBreakMinutes: 45 },
				at: at("2026-04-28T15:00:00Z"),
			},
		]);
	});

	it("dates a threshold the day's earlier work already passed to the live work's start", () => {
		const status = breakDueStatus(
			input({
				regulation: {
					maxUninterruptedMinutes: null,
					breakRules: [{ workingMinutesThreshold: 360, requiredBreakMinutes: 30 }],
				},
				completedMinutes: 400,
			}),
		);
		expect(status.breaches[0].at).toEqual(at("2026-04-28T06:00:00Z"));
	});

	it("names the break the day's work requires now under the highest threshold it passed", () => {
		const regulation = {
			maxUninterruptedMinutes: null,
			breakRules: [
				{ workingMinutesThreshold: 360, requiredBreakMinutes: 30 },
				{ workingMinutesThreshold: 540, requiredBreakMinutes: 45 },
			],
		};
		// 120 completed + 240 live = 360 worked: the 6 h threshold is reached, not passed.
		expect(breakDueStatus(input({ regulation, completedMinutes: 120 })).requirement).toBeNull();
		expect(
			breakDueStatus(input({ regulation, completedMinutes: 330, breakMinutes: 20 })).requirement,
		).toEqual({ totalNeeded: 45, taken: 20, remaining: 25 });
		expect(
			breakDueStatus(input({ regulation, completedMinutes: 200, breakMinutes: 40 })).requirement,
		).toEqual({ totalNeeded: 30, taken: 40, remaining: 0 });
	});

	it("finds nothing without a regulated policy or without limits and rules", () => {
		expect(breakDueStatus(input({ regulation: null })).breaches).toEqual([]);
		expect(
			breakDueStatus(input({ regulation: { maxUninterruptedMinutes: null, breakRules: [] } }))
				.breaches,
		).toEqual([]);
	});
});

import { describe, expect, it } from "vitest";
import { parseInstant, parsePlainDate, parsePlainTimeMinute } from "@/lib/datetime/temporal-core";
import { type ClockingReminderType, clockingReminderOccasionKey } from "./occasion";
import {
	evaluatePolicyReminders,
	type PolicyDayFacts,
	policyDayOccasionKeys,
	type ReminderInput,
} from "./policy-reminders";
import { DEFAULT_CLOCKING_REMINDER_SETTINGS } from "./settings-policy";
import type { ReminderWork } from "./shift-reminders";

const at = parseInstant;

/** Work as discovery reads it; completed work records its whole minutes. */
function period(start: string, end: string | null, durationMinutes?: number): ReminderWork {
	return {
		start: at(start),
		end: end ? at(end) : null,
		durationMinutes:
			durationMinutes ?? (end ? at(start).until(at(end)).total({ unit: "minutes" }) : null),
	};
}
const enabled = {
	...DEFAULT_CLOCKING_REMINDER_SETTINGS,
	missedClockIn: { enabled: true, graceMinutes: 15 },
	forgottenClockOut: { enabled: true, graceMinutes: 30 },
};

// Monday 2026-04-27 in Europe/Berlin (UTC+2): a 09:00 latest clock-in is 07:00Z.
const MONDAY = "2026-04-27";
const monday = parsePlainDate(MONDAY);

function input(overrides: Partial<ReminderInput> = {}): ReminderInput {
	return {
		now: at("2026-04-27T07:15:00Z"),
		employeeId: "employee-1",
		timezone: "Europe/Berlin",
		settings: enabled,
		shifts: [],
		work: [],
		...overrides,
	};
}

/** A Monday-to-Friday policy: 8 h a day, latest clock-in 09:00 unless overridden. */
function policy(
	options: { latestClockIn?: string | null; requiredMinutes?: Record<string, number> } = {},
): PolicyDayFacts & { asked: string[] } {
	const asked: string[] = [];
	return {
		asked,
		latestClockIn: async (day) => {
			asked.push(`latestClockIn:${day.toString()}`);
			const latest = options.latestClockIn === undefined ? "09:00" : options.latestClockIn;
			return latest === null ? null : parsePlainTimeMinute(latest);
		},
		requiredMinutes: async (day) => {
			asked.push(`requiredMinutes:${day.toString()}`);
			return options.requiredMinutes?.[day.toString()] ?? 480;
		},
	};
}

describe("missed clock-in reminders from the work policy's latest clock-in", () => {
	it("is due from the latest clock-in plus grace on a work day without a shift", async () => {
		expect(
			await evaluatePolicyReminders(input({ now: at("2026-04-27T07:14:59Z") }), policy()),
		).toEqual([]);
		expect(await evaluatePolicyReminders(input(), policy())).toEqual([
			{
				type: "missed_clock_in_reminder",
				occasionKey: "missed_clock_in_reminder:policy_day:employee-1:2026-04-27",
				day: monday,
				expectedAt: at("2026-04-27T07:00:00Z"),
				shift: null,
			},
		]);
		expect(
			await evaluatePolicyReminders(input({ now: at("2026-04-27T21:59:00Z") }), policy()),
		).toHaveLength(1);
	});

	it("stays quiet when the policy has no latest clock-in, without reading requirements", async () => {
		const flextime = policy({ latestClockIn: null });
		expect(await evaluatePolicyReminders(input(), flextime)).toEqual([]);
		expect(flextime.asked).toEqual(["latestClockIn:2026-04-27"]);
	});

	it("stays quiet on a day without required hours", async () => {
		expect(
			await evaluatePolicyReminders(input(), policy({ requiredMinutes: { [MONDAY]: 0 } })),
		).toEqual([]);
	});

	it("is not due once work started that local day, even work that already ended", async () => {
		expect(
			await evaluatePolicyReminders(
				input({ work: [period("2026-04-27T04:00:00Z", "2026-04-27T05:00:00Z")] }),
				policy(),
			),
		).toEqual([]);
	});

	it("is not due while work from the previous day still covers the latest clock-in", async () => {
		expect(
			await evaluatePolicyReminders(
				input({ work: [period("2026-04-26T20:00:00Z", null)] }),
				// Sunday requires nothing, so the live work owes no forgotten clock-out either.
				policy({ requiredMinutes: { "2026-04-26": 0 } }),
			),
		).toEqual([]);
	});

	it("is due when the only work is from the previous day and has ended", async () => {
		expect(
			await evaluatePolicyReminders(
				input({ work: [period("2026-04-26T20:00:00Z", "2026-04-26T23:00:00Z")] }),
				policy(),
			),
		).toHaveLength(1);
	});

	it("leaves a day with a published shift to the shift rules", async () => {
		const shift = {
			id: "shift-1",
			date: parsePlainDate(MONDAY),
			startTime: "13:00",
			endTime: "17:00",
		};
		expect(await evaluatePolicyReminders(input({ shifts: [shift] }), policy())).toEqual([]);
	});

	it("is not due when the reminder type is disabled", async () => {
		const settings = { ...enabled, missedClockIn: { enabled: false, graceMinutes: 15 } };
		expect(await evaluatePolicyReminders(input({ settings }), policy())).toEqual([]);
	});

	it("reads the latest clock-in on the employee's own local day and timezone", async () => {
		const newYork = policy();
		const reminders = (now: string) =>
			evaluatePolicyReminders(input({ timezone: "America/New_York", now: at(now) }), newYork);
		// 09:15 in Berlin is 03:15 in New York.
		expect(await reminders("2026-04-27T07:15:00Z")).toEqual([]);
		// 09:15 EDT.
		expect(await reminders("2026-04-27T13:15:00Z")).toMatchObject([
			{ day: monday, expectedAt: at("2026-04-27T13:00:00Z") },
		]);
	});
});

describe("forgotten clock-out reminders once the day's required hours are reached", () => {
	// Clocked in at 08:00, a break from 12:00 to 12:30, clocked in again: 8 h are reached at 16:30.
	const morning = period("2026-04-27T06:00:00Z", "2026-04-27T10:00:00Z");
	const afternoon = period("2026-04-27T10:30:00Z", null);
	const noLatestClockIn = { latestClockIn: null };
	const evening = (now: string, overrides: Partial<ReminderInput> = {}) =>
		input({ now: at(now), work: [morning, afternoon], ...overrides });

	it("is due once the worked time reaches the required hours plus grace", async () => {
		expect(
			await evaluatePolicyReminders(evening("2026-04-27T14:59:59Z"), policy(noLatestClockIn)),
		).toEqual([]);
		expect(
			await evaluatePolicyReminders(evening("2026-04-27T15:00:00Z"), policy(noLatestClockIn)),
		).toEqual([
			{
				type: "forgotten_clock_out_reminder",
				occasionKey: "forgotten_clock_out_reminder:policy_day:employee-1:2026-04-27",
				day: monday,
				expectedAt: at("2026-04-27T14:30:00Z"),
				shift: null,
			},
		]);
	});

	it("counts completed work by its recorded minutes, like the compliance check", async () => {
		// 08:00 to 12:00 recorded as 3 h 50 min: 8 h are reached at 16:40, not 16:30.
		const recorded = period("2026-04-27T06:00:00Z", "2026-04-27T10:00:00Z", 230);
		const reminders = (now: string) =>
			evaluatePolicyReminders(
				evening(now, { work: [recorded, afternoon] }),
				policy(noLatestClockIn),
			);
		expect(await reminders("2026-04-27T15:09:59Z")).toEqual([]);
		expect(await reminders("2026-04-27T15:10:00Z")).toMatchObject([
			{ type: "forgotten_clock_out_reminder", expectedAt: at("2026-04-27T14:40:00Z") },
		]);
	});

	it("is not due once the work has ended", async () => {
		expect(
			await evaluatePolicyReminders(
				evening("2026-04-27T16:00:00Z", {
					work: [morning, period("2026-04-27T10:30:00Z", "2026-04-27T15:30:00Z")],
				}),
				policy(noLatestClockIn),
			),
		).toEqual([]);
	});

	it("judges live work past midnight against the day it started", async () => {
		// Monday 22:00 to Tuesday 06:30 Berlin is 8 h 30 min of work.
		const overnight = policy({ ...noLatestClockIn, requiredMinutes: { "2026-04-28": 0 } });
		expect(
			await evaluatePolicyReminders(
				input({
					now: at("2026-04-28T04:30:00Z"),
					work: [period("2026-04-27T20:00:00Z", null)],
				}),
				overnight,
			),
		).toMatchObject([{ type: "forgotten_clock_out_reminder", day: monday }]);
		expect(overnight.asked).toContain("requiredMinutes:2026-04-27");
	});

	it("does not count work from an earlier day", async () => {
		expect(
			await evaluatePolicyReminders(
				input({
					now: at("2026-04-27T15:00:00Z"),
					work: [
						period("2026-04-26T06:00:00Z", "2026-04-26T14:00:00Z"),
						period("2026-04-27T10:30:00Z", null),
					],
				}),
				policy(noLatestClockIn),
			),
		).toEqual([]);
	});

	it("stays quiet on a day without required hours", async () => {
		expect(
			await evaluatePolicyReminders(
				evening("2026-04-27T20:00:00Z"),
				policy({ ...noLatestClockIn, requiredMinutes: { [MONDAY]: 0 } }),
			),
		).toEqual([]);
	});

	it("leaves live work that matches a published shift to the shift rules", async () => {
		// The afternoon work started at 12:30, inside a 12:00 to 20:00 shift.
		const shift = { id: "shift-1", date: monday, startTime: "12:00", endTime: "20:00" };
		expect(
			await evaluatePolicyReminders(
				evening("2026-04-27T20:00:00Z", { shifts: [shift] }),
				policy(noLatestClockIn),
			),
		).toEqual([]);
	});

	it("judges live work that matches no shift by the policy, even on a day with a shift", async () => {
		// A morning shift ended at 12:00; the live work started at 12:30, after it.
		const shift = { id: "shift-1", date: monday, startTime: "08:00", endTime: "12:00" };
		expect(
			await evaluatePolicyReminders(
				evening("2026-04-27T15:00:00Z", { shifts: [shift] }),
				policy(noLatestClockIn),
			),
		).toEqual([
			{
				type: "forgotten_clock_out_reminder",
				occasionKey: "forgotten_clock_out_reminder:policy_day:employee-1:2026-04-27",
				day: monday,
				expectedAt: at("2026-04-27T14:30:00Z"),
				shift: null,
			},
		]);
	});

	it("is not due when the reminder type is disabled", async () => {
		const settings = { ...enabled, forgottenClockOut: { enabled: false, graceMinutes: 30 } };
		expect(
			await evaluatePolicyReminders(
				evening("2026-04-27T20:00:00Z", { settings }),
				policy(noLatestClockIn),
			),
		).toEqual([]);
	});
});

describe("policy-day occasions already recorded as sent", () => {
	const occasion = (type: ClockingReminderType, day: string) =>
		clockingReminderOccasionKey(type, {
			kind: "policy_day",
			employeeId: "employee-1",
			day: parsePlainDate(day),
		});
	const recorded = (...keys: string[]) => new Set(keys);
	const overnight = [period("2026-04-27T20:00:00Z", null)];

	it("skips the policy lookups of a missed clock-in already sent today", async () => {
		const facts = policy();
		expect(
			await evaluatePolicyReminders(
				input({ now: at("2026-04-27T15:00:00Z") }),
				facts,
				recorded(occasion("missed_clock_in_reminder", MONDAY)),
			),
		).toEqual([]);
		expect(facts.asked).toEqual([]);
	});

	it("still judges today's missed clock-in when only an earlier day's is recorded", async () => {
		expect(
			await evaluatePolicyReminders(
				input(),
				policy(),
				recorded(occasion("missed_clock_in_reminder", "2026-04-24")),
			),
		).toMatchObject([{ type: "missed_clock_in_reminder", day: monday }]);
	});

	it("skips the required-minutes lookup of a forgotten clock-out already sent", async () => {
		const facts = policy();
		expect(
			await evaluatePolicyReminders(
				input({ now: at("2026-04-28T07:15:00Z"), work: overnight }),
				facts,
				recorded(occasion("forgotten_clock_out_reminder", MONDAY)),
			),
		).toEqual([]);
		// Tuesday's missed clock-in is still judged; the overnight work covers it.
		expect(facts.asked).toEqual(["latestClockIn:2026-04-28"]);
	});

	it("still sends a forgotten clock-out when only the missed clock-in is recorded", async () => {
		const facts = policy();
		expect(
			await evaluatePolicyReminders(
				input({ now: at("2026-04-28T07:15:00Z"), work: overnight }),
				facts,
				recorded(occasion("missed_clock_in_reminder", "2026-04-28")),
			),
		).toMatchObject([{ type: "forgotten_clock_out_reminder", day: monday }]);
		expect(facts.asked).toEqual(["requiredMinutes:2026-04-27"]);
	});

	it("lists the keys of the occasions the evaluator may judge now", () => {
		expect(policyDayOccasionKeys(input())).toEqual([occasion("missed_clock_in_reminder", MONDAY)]);
		expect(
			policyDayOccasionKeys(input({ now: at("2026-04-28T07:15:00Z"), work: overnight })),
		).toEqual([
			occasion("missed_clock_in_reminder", "2026-04-28"),
			occasion("forgotten_clock_out_reminder", MONDAY),
		]);
		const settings = {
			...enabled,
			missedClockIn: { enabled: false, graceMinutes: 15 },
			forgottenClockOut: { enabled: false, graceMinutes: 30 },
		};
		expect(policyDayOccasionKeys(input({ settings, work: overnight }))).toEqual([]);
	});
});

import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	evaluatePolicyReminders,
	type PolicyDayFacts,
	type PolicyReminderInput,
} from "./policy-reminders";
import { DEFAULT_CLOCKING_REMINDER_SETTINGS } from "./settings-policy";

const at = parseInstant;
const enabled = {
	...DEFAULT_CLOCKING_REMINDER_SETTINGS,
	missedClockIn: { enabled: true, graceMinutes: 15 },
	forgottenClockOut: { enabled: true, graceMinutes: 30 },
};

// Monday 2026-04-27 in Europe/Berlin (UTC+2): a 09:00 latest clock-in is 07:00Z.
const MONDAY = "2026-04-27";

function input(overrides: Partial<PolicyReminderInput> = {}): PolicyReminderInput {
	return {
		now: at("2026-04-27T07:15:00Z"),
		employeeId: "employee-1",
		timezone: "Europe/Berlin",
		organizationTimezone: "Europe/Berlin",
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
			asked.push(`latestClockIn:${day}`);
			return options.latestClockIn === undefined ? "09:00" : options.latestClockIn;
		},
		requiredMinutes: async (day) => {
			asked.push(`requiredMinutes:${day}`);
			return options.requiredMinutes?.[day] ?? 480;
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
				day: MONDAY,
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
				input({ work: [{ start: at("2026-04-27T04:00:00Z"), end: at("2026-04-27T05:00:00Z") }] }),
				policy(),
			),
		).toEqual([]);
	});

	it("is not due while work from the previous day still covers the latest clock-in", async () => {
		expect(
			await evaluatePolicyReminders(
				input({ work: [{ start: at("2026-04-26T20:00:00Z"), end: null }] }),
				// Sunday requires nothing, so the live work owes no forgotten clock-out either.
				policy({ requiredMinutes: { "2026-04-26": 0 } }),
			),
		).toEqual([]);
	});

	it("is due when the only work is from the previous day and has ended", async () => {
		expect(
			await evaluatePolicyReminders(
				input({ work: [{ start: at("2026-04-26T20:00:00Z"), end: at("2026-04-26T23:00:00Z") }] }),
				policy(),
			),
		).toHaveLength(1);
	});

	it("leaves a day with a published shift to the shift rules", async () => {
		const shift = {
			id: "shift-1",
			date: at("2026-04-26T22:00:00Z"),
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
			{ day: MONDAY, expectedAt: at("2026-04-27T13:00:00Z") },
		]);
	});
});

describe("forgotten clock-out reminders once the day's required hours are reached", () => {
	// Clocked in at 08:00, a break from 12:00 to 12:30, clocked in again: 8 h are reached at 16:30.
	const morning = { start: at("2026-04-27T06:00:00Z"), end: at("2026-04-27T10:00:00Z") };
	const afternoon = { start: at("2026-04-27T10:30:00Z"), end: null };
	const noLatestClockIn = { latestClockIn: null };
	const evening = (now: string, overrides: Partial<PolicyReminderInput> = {}) =>
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
				day: MONDAY,
				expectedAt: at("2026-04-27T14:30:00Z"),
				shift: null,
			},
		]);
	});

	it("is not due once the work has ended", async () => {
		expect(
			await evaluatePolicyReminders(
				evening("2026-04-27T16:00:00Z", {
					work: [morning, { start: afternoon.start, end: at("2026-04-27T15:30:00Z") }],
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
					work: [{ start: at("2026-04-27T20:00:00Z"), end: null }],
				}),
				overnight,
			),
		).toMatchObject([{ type: "forgotten_clock_out_reminder", day: MONDAY }]);
		expect(overnight.asked).toContain("requiredMinutes:2026-04-27");
	});

	it("does not count work from an earlier day", async () => {
		expect(
			await evaluatePolicyReminders(
				input({
					now: at("2026-04-27T15:00:00Z"),
					work: [
						{ start: at("2026-04-26T06:00:00Z"), end: at("2026-04-26T14:00:00Z") },
						{ start: at("2026-04-27T10:30:00Z"), end: null },
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

	it("leaves a day with a published shift to the shift rules", async () => {
		const shift = {
			id: "shift-1",
			date: at("2026-04-26T22:00:00Z"),
			startTime: "08:00",
			endTime: "12:00",
		};
		expect(
			await evaluatePolicyReminders(
				evening("2026-04-27T20:00:00Z", { shifts: [shift] }),
				policy(noLatestClockIn),
			),
		).toEqual([]);
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

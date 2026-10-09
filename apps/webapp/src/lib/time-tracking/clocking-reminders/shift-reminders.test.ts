import { describe, expect, it } from "vitest";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import { DEFAULT_CLOCKING_REMINDER_SETTINGS } from "./settings-policy";
import { evaluateShiftReminders, type ShiftReminderInput } from "./shift-reminders";

const at = parseInstant;
const enabled = {
	...DEFAULT_CLOCKING_REMINDER_SETTINGS,
	missedClockIn: { enabled: true, graceMinutes: 15 },
	forgottenClockOut: { enabled: true, graceMinutes: 30 },
};

// 08:00-16:00 on 2026-04-28 in Europe/Berlin (06:00Z-14:00Z).
const berlinShift = {
	id: "shift-1",
	date: parsePlainDate("2026-04-28"),
	startTime: "08:00",
	endTime: "16:00",
};

function input(overrides: Partial<ShiftReminderInput>): ShiftReminderInput {
	return {
		now: at("2026-04-28T06:15:00Z"),
		employeeId: "employee-1",
		timezone: "Europe/Berlin",
		settings: enabled,
		shifts: [berlinShift],
		work: [],
		...overrides,
	};
}

describe("missed clock-in reminders for published shifts", () => {
	it("is due from the expected start plus grace until the shift end", () => {
		expect(evaluateShiftReminders(input({ now: at("2026-04-28T06:14:59Z") }))).toEqual([]);

		const due = evaluateShiftReminders(input({ now: at("2026-04-28T06:15:00Z") }));
		expect(due).toEqual([
			{
				type: "missed_clock_in_reminder",
				occasionKey: "missed_clock_in_reminder:shift:shift-1:employee-1",
				day: parsePlainDate("2026-04-28"),
				expectedAt: at("2026-04-28T06:00:00Z"),
				shift: {
					id: "shift-1",
					start: at("2026-04-28T06:00:00Z"),
					end: at("2026-04-28T14:00:00Z"),
				},
			},
		]);

		expect(evaluateShiftReminders(input({ now: at("2026-04-28T13:59:00Z") }))).toHaveLength(1);
		expect(evaluateShiftReminders(input({ now: at("2026-04-28T14:00:00Z") }))).toEqual([]);
	});

	it("is not due when work started inside the shift window", () => {
		expect(
			evaluateShiftReminders(input({ work: [{ start: at("2026-04-28T05:30:00Z"), end: null }] })),
		).toEqual([]);
	});

	it("is not due while earlier work still covers the shift start", () => {
		expect(
			evaluateShiftReminders(
				input({
					now: at("2026-04-28T07:00:00Z"),
					work: [{ start: at("2026-04-28T03:00:00Z"), end: at("2026-04-28T06:30:00Z") }],
				}),
			),
		).toEqual([]);
	});

	it("is due when the only work ended before the shift start", () => {
		expect(
			evaluateShiftReminders(
				input({ work: [{ start: at("2026-04-28T04:30:00Z"), end: at("2026-04-28T05:00:00Z") }] }),
			),
		).toHaveLength(1);
	});

	it("is not due when the reminder type is disabled", () => {
		expect(
			evaluateShiftReminders(
				input({
					settings: { ...enabled, missedClockIn: { enabled: false, graceMinutes: 15 } },
				}),
			),
		).toEqual([]);
	});

	it("uses the configured grace", () => {
		const settings = { ...enabled, missedClockIn: { enabled: true, graceMinutes: 40 } };
		expect(evaluateShiftReminders(input({ settings, now: at("2026-04-28T06:39:00Z") }))).toEqual(
			[],
		);
		expect(
			evaluateShiftReminders(input({ settings, now: at("2026-04-28T06:40:00Z") })),
		).toHaveLength(1);
	});

	it("reads shift times in the employee's own timezone on the shift's date", () => {
		// The employee works from New York (08:00 EDT = 12:00Z).
		const reminders = (now: string) =>
			evaluateShiftReminders(input({ timezone: "America/New_York", now: at(now) }));
		expect(reminders("2026-04-28T06:15:00Z")).toEqual([]);
		expect(reminders("2026-04-28T12:15:00Z")).toMatchObject([
			{
				type: "missed_clock_in_reminder",
				day: parsePlainDate("2026-04-28"),
				expectedAt: at("2026-04-28T12:00:00Z"),
			},
		]);
	});
});

describe("forgotten clock-out reminders for published shifts", () => {
	const live = { start: at("2026-04-28T05:55:00Z"), end: null };

	it("is due once matching live work runs past the shift end plus grace", () => {
		expect(
			evaluateShiftReminders(input({ now: at("2026-04-28T14:29:59Z"), work: [live] })),
		).toEqual([]);
		expect(
			evaluateShiftReminders(input({ now: at("2026-04-28T14:30:00Z"), work: [live] })),
		).toEqual([
			{
				type: "forgotten_clock_out_reminder",
				occasionKey: "forgotten_clock_out_reminder:shift:shift-1:employee-1",
				day: parsePlainDate("2026-04-28"),
				expectedAt: at("2026-04-28T14:00:00Z"),
				shift: {
					id: "shift-1",
					start: at("2026-04-28T06:00:00Z"),
					end: at("2026-04-28T14:00:00Z"),
				},
			},
		]);
	});

	it("is not due once the work has ended", () => {
		expect(
			evaluateShiftReminders(
				input({
					now: at("2026-04-28T15:00:00Z"),
					work: [{ start: live.start, end: at("2026-04-28T14:05:00Z") }],
				}),
			),
		).toEqual([]);
	});

	it("is not due for live work that does not match the shift", () => {
		expect(
			evaluateShiftReminders(
				input({
					now: at("2026-04-28T15:00:00Z"),
					work: [{ start: at("2026-04-28T14:10:00Z"), end: null }],
				}),
			),
		).toEqual([]);
	});

	it("is not due when the reminder type is disabled", () => {
		expect(
			evaluateShiftReminders(
				input({
					now: at("2026-04-28T15:00:00Z"),
					work: [live],
					settings: { ...enabled, forgottenClockOut: { enabled: false, graceMinutes: 30 } },
				}),
			),
		).toEqual([]);
	});
});

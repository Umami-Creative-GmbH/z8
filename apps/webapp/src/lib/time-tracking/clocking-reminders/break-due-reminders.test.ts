import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { type BreakDueReminderInput, evaluateBreakDueReminders } from "./break-due-reminders";
import { DEFAULT_CLOCKING_REMINDER_SETTINGS } from "./settings-policy";

const at = parseInstant;
const enabled = {
	...DEFAULT_CLOCKING_REMINDER_SETTINGS,
	breakDue: { enabled: true, leadMinutes: 15 },
};

// Live work since 08:00 in Europe/Berlin (06:00Z) under a 6 h uninterrupted-work limit.
function input(overrides: Partial<BreakDueReminderInput>): BreakDueReminderInput {
	return {
		now: at("2026-04-28T11:45:00Z"),
		timezone: "Europe/Berlin",
		settings: enabled,
		liveWork: { id: "work-1", start: at("2026-04-28T06:00:00Z") },
		regulation: { maxUninterruptedMinutes: 360, breakRules: [] },
		completedMinutes: 0,
		breakMinutes: 0,
		...overrides,
	};
}

describe("break-due reminders for live work", () => {
	it("is due from the lead minutes before the break is due until it is due", () => {
		expect(evaluateBreakDueReminders(input({ now: at("2026-04-28T11:44:59Z") }))).toEqual([]);
		expect(evaluateBreakDueReminders(input({}))).toEqual([
			{
				type: "break_due_reminder",
				occasionKey: "break_due_reminder:live_work:work-1:max_uninterrupted",
				day: "2026-04-28",
				expectedAt: at("2026-04-28T12:00:00Z"),
				shift: null,
			},
		]);
		expect(evaluateBreakDueReminders(input({ now: at("2026-04-28T11:59:59Z") }))).toHaveLength(1);
		expect(evaluateBreakDueReminders(input({ now: at("2026-04-28T12:00:00Z") }))).toEqual([]);
	});

	it("reminds of the next threshold rule once the earlier breach has passed", () => {
		const regulation = {
			maxUninterruptedMinutes: 360,
			breakRules: [{ workingMinutesThreshold: 390, requiredBreakMinutes: 30 }],
		};
		expect(
			evaluateBreakDueReminders(input({ regulation, now: at("2026-04-28T12:15:00Z") })),
		).toMatchObject([
			{
				occasionKey: "break_due_reminder:live_work:work-1:break_rule:390",
				expectedAt: at("2026-04-28T12:30:00Z"),
			},
		]);
	});

	it("names one occasion when the limit and a rule fall due together", () => {
		const regulation = {
			maxUninterruptedMinutes: 360,
			breakRules: [{ workingMinutesThreshold: 360, requiredBreakMinutes: 30 }],
		};
		expect(evaluateBreakDueReminders(input({ regulation }))).toMatchObject([
			{ occasionKey: "break_due_reminder:live_work:work-1:max_uninterrupted" },
		]);
	});

	it("is not due when switched off, without a policy, or when breaks already meet the rule", () => {
		expect(
			evaluateBreakDueReminders(
				input({ settings: { ...enabled, breakDue: { enabled: false, leadMinutes: 15 } } }),
			),
		).toEqual([]);
		expect(evaluateBreakDueReminders(input({ regulation: null }))).toEqual([]);
		expect(
			evaluateBreakDueReminders(
				input({
					regulation: {
						maxUninterruptedMinutes: null,
						breakRules: [{ workingMinutesThreshold: 360, requiredBreakMinutes: 30 }],
					},
					breakMinutes: 30,
				}),
			),
		).toEqual([]);
	});

	it("files the occasion under the live work's local start day", () => {
		const due = evaluateBreakDueReminders(
			input({
				liveWork: { id: "work-2", start: at("2026-04-28T21:30:00Z") },
				now: at("2026-04-29T03:20:00Z"),
			}),
		);
		expect(due).toMatchObject([{ day: "2026-04-28", expectedAt: at("2026-04-29T03:30:00Z") }]);
	});
});

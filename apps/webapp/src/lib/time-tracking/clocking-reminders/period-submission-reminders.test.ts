import { describe, expect, it } from "vitest";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	evaluatePeriodSubmissionReminders,
	type PeriodSubmissionReminderInput,
} from "./period-submission-reminders";

const at = parseInstant;
const day = parsePlainDate;

// The week 2026-03-02..08 in Europe/Berlin ends at 2026-03-09T00:00+01:00 (2026-03-08T23:00Z).
const week = {
	startDate: day("2026-03-02"),
	endDate: day("2026-03-08"),
	timezone: "Europe/Berlin",
};

function input(overrides: Partial<PeriodSubmissionReminderInput>): PeriodSubmissionReminderInput {
	return {
		now: at("2026-03-08T23:00:00Z"),
		employeeId: "employee-1",
		periods: [week],
		submittedEndDates: new Set(),
		secondReminderDelayDays: 3,
		...overrides,
	};
}

const firstKey = "period_submission_reminder:submission_period:employee-1:2026-03-08:period_end";
const secondKey = "period_submission_reminder:submission_period:employee-1:2026-03-08:after_delay";

describe("period submission reminders", () => {
	it("is due once the period ends in the employee's zone", () => {
		expect(evaluatePeriodSubmissionReminders(input({ now: at("2026-03-08T22:59:59Z") }))).toEqual(
			[],
		);
		expect(evaluatePeriodSubmissionReminders(input({}))).toEqual([
			{
				type: "period_submission_reminder",
				occasionKey: firstKey,
				day: day("2026-03-08"),
				expectedAt: at("2026-03-08T23:00:00Z"),
				shift: null,
				submissionPeriod: {
					startDate: day("2026-03-02"),
					endDate: day("2026-03-08"),
					stage: "period_end",
				},
			},
		]);
	});

	it("is due again after the configured delay, from the employee's local midnight", () => {
		const due = evaluatePeriodSubmissionReminders(input({ now: at("2026-03-11T23:00:00Z") }));
		expect(due).toMatchObject([
			{
				occasionKey: secondKey,
				expectedAt: at("2026-03-11T23:00:00Z"),
				submissionPeriod: { stage: "after_delay" },
			},
		]);
	});

	it("never offers both reminders at once when a run comes late", () => {
		expect(
			evaluatePeriodSubmissionReminders(input({ now: at("2026-03-10T08:00:00Z") })),
		).toMatchObject([{ occasionKey: firstKey }]);
		expect(
			evaluatePeriodSubmissionReminders(
				input({ secondReminderDelayDays: 1, now: at("2026-03-10T08:00:00Z") }),
			),
		).toMatchObject([{ occasionKey: secondKey, expectedAt: at("2026-03-09T23:00:00Z") }]);
	});

	it("stops offering a reminder well inside the occasion retention", () => {
		// First reminder: three days after the period ended, while the second is still weeks away.
		const late = input({ secondReminderDelayDays: 30 });
		expect(
			evaluatePeriodSubmissionReminders({ ...late, now: at("2026-03-11T22:59:59Z") }),
		).toHaveLength(1);
		expect(evaluatePeriodSubmissionReminders({ ...late, now: at("2026-03-11T23:00:00Z") })).toEqual(
			[],
		);
		// Second reminder: three days after it fell due.
		expect(
			evaluatePeriodSubmissionReminders({ ...late, now: at("2026-04-07T22:00:00Z") }),
		).toMatchObject([{ occasionKey: secondKey, expectedAt: at("2026-04-07T22:00:00Z") }]);
		expect(evaluatePeriodSubmissionReminders({ ...late, now: at("2026-04-10T22:00:00Z") })).toEqual(
			[],
		);
	});

	it("is not due for a submitted period", () => {
		expect(
			evaluatePeriodSubmissionReminders(input({ submittedEndDates: new Set(["2026-03-08"]) })),
		).toEqual([]);
	});

	it("is not due without an expected period", () => {
		expect(evaluatePeriodSubmissionReminders(input({ periods: [] }))).toEqual([]);
	});

	it("follows each period's own end in its zone", () => {
		const due = evaluatePeriodSubmissionReminders(
			input({
				now: at("2026-03-31T22:00:00Z"),
				periods: [
					week,
					{ startDate: day("2026-03-01"), endDate: day("2026-03-31"), timezone: "Europe/Berlin" },
				],
			}),
		);
		// Summer time: April 1st starts at 22:00Z.
		expect(due).toMatchObject([
			{
				occasionKey:
					"period_submission_reminder:submission_period:employee-1:2026-03-31:period_end",
				expectedAt: at("2026-03-31T22:00:00Z"),
			},
		]);
	});
});

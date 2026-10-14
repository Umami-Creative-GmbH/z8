import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	DRIVING_DETAILS_REMINDER_DUE_DAYS,
	drivingDetailsReminderAt,
	evaluateDrivingDetailsReminders,
} from "./driving-details-reminders";

const at = parseInstant;

const work = {
	workPeriodId: "work-1",
	workDay: "2026-09-07",
	endedAt: "2026-09-07T14:00:00Z",
};

describe("drivingDetailsReminderAt", () => {
	it("is 08:00 on the employee's local day after the work ended", () => {
		expect(drivingDetailsReminderAt(at("2026-09-07T14:00:00Z"), "Europe/Berlin").toString()).toBe(
			"2026-09-08T06:00:00Z",
		);
		// Ended after local midnight: the morning after is the next local day's.
		expect(drivingDetailsReminderAt(at("2026-09-07T22:30:00Z"), "Europe/Berlin").toString()).toBe(
			"2026-09-09T06:00:00Z",
		);
		expect(
			drivingDetailsReminderAt(at("2026-09-07T22:30:00Z"), "America/New_York").toString(),
		).toBe("2026-09-08T12:00:00Z");
	});
});

describe("evaluateDrivingDetailsReminders", () => {
	const evaluate = (now: string) =>
		evaluateDrivingDetailsReminders({ now: at(now), timezone: "Europe/Berlin", work: [work] });

	it("is not due before the morning after", () => {
		expect(evaluate("2026-09-08T05:59:00Z")).toEqual([]);
	});

	it("is due from the morning after, once per work period", () => {
		const [reminder] = evaluate("2026-09-08T06:00:00Z");
		expect(reminder).toMatchObject({
			type: "driving_details_missing_reminder",
			occasionKey: "driving_details_missing_reminder:work_period:work-1",
			shift: null,
		});
		expect(reminder.day.toString()).toBe("2026-09-07");
		expect(reminder.expectedAt.toString()).toBe("2026-09-08T06:00:00Z");
		expect(reminder.drivingWork?.workPeriodId).toBe("work-1");
	});

	it("stops being due after its window, inside the occasion retention, so it is never sent twice", () => {
		expect(DRIVING_DETAILS_REMINDER_DUE_DAYS).toBeLessThan(7);
		expect(evaluate("2026-09-11T05:59:00Z")).toHaveLength(1);
		expect(evaluate("2026-09-11T06:00:00Z")).toEqual([]);
	});
});

import { describe, expect, it } from "vitest";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import { buildClockingReminderNotification } from "./notifications";

const at = parseInstant;

describe("buildClockingReminderNotification", () => {
	// Live work from Monday 22:00 Berlin reached Monday's 8 h at Tuesday 06:00 Berlin.
	const overnight = {
		type: "forgotten_clock_out_reminder" as const,
		occasionKey: "forgotten_clock_out_reminder:policy_day:employee-1:2026-04-27",
		day: parsePlainDate("2026-04-27"),
		expectedAt: at("2026-04-28T04:00:00Z"),
		shift: null,
	};
	function build(locale: string) {
		const notification = buildClockingReminderNotification({
			reminder: overnight,
			organizationId: "org-1",
			userId: "user-1",
			timezone: "Europe/Berlin",
			locale,
		});
		const i18n = notification.metadata?.i18n as {
			messageKey: string;
			params: Record<string, string>;
		};
		return { message: notification.message, i18n };
	}

	it("names the day whose required hours a policy forgotten clock-out was judged against", () => {
		const { message, i18n } = build("en");
		expect(message).toBe(
			`You reached the required hours for Monday, April 27 at ${i18n.params.endTime} (Europe/Berlin). Clock out if you have finished working.`,
		);
		expect(i18n).toMatchObject({
			messageKey: "common:notifications.content.policyForgottenClockOutReminder.message",
			params: { day: "Monday, April 27", timezone: "Europe/Berlin" },
		});
	});

	it("formats the day and time in the employee's locale", () => {
		expect(build("de").i18n.params).toMatchObject({ day: "Montag, 27. April", endTime: "06:00" });
	});
});

describe("period submission reminder notifications", () => {
	function build(stage: "period_end" | "after_delay", locale = "en") {
		return buildClockingReminderNotification({
			reminder: {
				type: "period_submission_reminder",
				occasionKey: `period_submission_reminder:submission_period:employee-1:2026-03-08:${stage}`,
				day: parsePlainDate("2026-03-08"),
				expectedAt: at("2026-03-08T23:00:00Z"),
				shift: null,
				submissionPeriod: {
					startDate: parsePlainDate("2026-03-02"),
					endDate: parsePlainDate("2026-03-08"),
					stage,
				},
			},
			organizationId: "org-1",
			userId: "user-1",
			timezone: "Europe/Berlin",
			locale,
		});
	}

	it("asks the employee to submit the period that just ended", () => {
		const notification = build("period_end");
		expect(notification).toMatchObject({
			type: "period_submission_reminder",
			title: "Submit your time for approval",
			message:
				"Your period Mar 2, 2026 – Mar 8, 2026 has ended. Review your time and submit it for approval.",
			actionUrl: "/time-tracking",
			idempotencyKey:
				"clocking-reminder:period_submission_reminder:submission_period:employee-1:2026-03-08:period_end",
			metadata: {
				i18n: {
					titleKey: "common:notifications.content.periodSubmissionReminder.title",
					messageKey: "common:notifications.content.periodSubmissionReminder.message",
					params: { startDate: "Mar 2, 2026", endDate: "Mar 8, 2026" },
				},
			},
		});
	});

	it("says the period is still not submitted in the second reminder", () => {
		expect(build("after_delay")).toMatchObject({
			title: "Your time is still not submitted",
			message:
				"Your period Mar 2, 2026 – Mar 8, 2026 is still not submitted. Review your time and submit it for approval.",
			metadata: {
				i18n: {
					titleKey: "common:notifications.content.periodSubmissionSecondReminder.title",
					messageKey: "common:notifications.content.periodSubmissionSecondReminder.message",
				},
			},
		});
	});

	it("formats the period's dates in the employee's locale", () => {
		expect(build("period_end", "de").metadata?.i18n).toMatchObject({
			params: { startDate: "02.03.2026", endDate: "08.03.2026" },
		});
	});
});

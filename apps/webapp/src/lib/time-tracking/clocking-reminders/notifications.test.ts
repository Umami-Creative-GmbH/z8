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

describe("period submission decided notifications (#805)", () => {
	function build(outcome: "approved" | "rejected", reason: string | null = null) {
		return buildClockingReminderNotification({
			reminder: {
				type: "period_submission_decided",
				occasionKey: "period_submission_decided:period_submission:submission-1",
				day: parsePlainDate("2026-03-08"),
				expectedAt: at("2026-03-09T09:00:00Z"),
				shift: null,
				decidedPeriod: {
					startDate: parsePlainDate("2026-03-02"),
					endDate: parsePlainDate("2026-03-08"),
					outcome,
					reason,
				},
			},
			organizationId: "org-1",
			userId: "user-1",
			timezone: "Europe/Berlin",
			locale: "en",
		});
	}

	it("tells the employee their period was approved", () => {
		expect(build("approved")).toMatchObject({
			type: "period_submission_decided",
			title: "Your time was approved",
			message: "Your time for Mar 2, 2026 – Mar 8, 2026 was approved.",
			actionUrl: "/time-tracking",
			idempotencyKey: "clocking-reminder:period_submission_decided:period_submission:submission-1",
		});
	});

	it("tells the employee their period was rejected, with the approver's reason", () => {
		expect(build("rejected", "Friday {is} missing")).toMatchObject({
			title: "Your time was rejected",
			message:
				"Your time for Mar 2, 2026 – Mar 8, 2026 was rejected: Friday {is} missing. Review your time and submit it again.",
			metadata: {
				i18n: {
					titleKey: "common:notifications.content.periodSubmissionRejected.title",
					messageKey: "common:notifications.content.periodSubmissionRejected.message",
					params: { reason: "Friday {is} missing" },
				},
			},
		});
	});
});

describe("period submission sent back notifications (#1062)", () => {
	function build(outcome: "withdrawn" | "outdated") {
		return buildClockingReminderNotification({
			reminder: {
				type: "period_submission_sent_back",
				occasionKey: "period_submission_sent_back:period_submission:submission-1",
				day: parsePlainDate("2026-03-08"),
				expectedAt: at("2026-03-10T09:00:00Z"),
				shift: null,
				sentBackPeriod: {
					startDate: parsePlainDate("2026-03-02"),
					endDate: parsePlainDate("2026-03-08"),
					outcome,
				},
			},
			organizationId: "org-1",
			userId: "user-1",
			timezone: "Europe/Berlin",
			locale: "en",
		});
	}

	it("tells the employee to submit again after their pending submission was withdrawn", () => {
		expect(build("withdrawn")).toMatchObject({
			type: "period_submission_sent_back",
			title: "Submit your time again",
			message:
				"Your time for Mar 2, 2026 – Mar 8, 2026 changed after you submitted it, so the submission was withdrawn. Review your time and submit it again.",
			actionUrl: "/time-tracking",
			idempotencyKey:
				"clocking-reminder:period_submission_sent_back:period_submission:submission-1",
			metadata: {
				i18n: {
					titleKey: "common:notifications.content.periodSubmissionWithdrawnAfterChange.title",
					messageKey: "common:notifications.content.periodSubmissionWithdrawnAfterChange.message",
					params: { startDate: "Mar 2, 2026", endDate: "Mar 8, 2026" },
				},
			},
		});
	});

	it("tells the employee their approval is out of date after a change to an approved period", () => {
		expect(build("outdated")).toMatchObject({
			title: "Your approved time is out of date",
			message:
				"Your time for Mar 2, 2026 – Mar 8, 2026 changed after it was approved. Review your time and submit it again.",
			metadata: {
				i18n: {
					titleKey: "common:notifications.content.periodSubmissionOutdated.title",
					messageKey: "common:notifications.content.periodSubmissionOutdated.message",
				},
			},
		});
	});
});

describe("driving details missing reminders (#1127)", () => {
	it("names the day of the work lacking its vehicle or a reading, in the employee's locale", () => {
		const reminder = {
			type: "driving_details_missing_reminder" as const,
			occasionKey: "driving_details_missing_reminder:work_period:work-1",
			day: parsePlainDate("2026-09-07"),
			expectedAt: at("2026-09-08T06:00:00Z"),
			shift: null,
			drivingWork: { workPeriodId: "work-1", workDay: parsePlainDate("2026-09-07") },
		};
		const build = (locale: string) =>
			buildClockingReminderNotification({
				reminder,
				organizationId: "org-1",
				userId: "user-1",
				timezone: "Europe/Berlin",
				locale,
			});
		expect(build("en")).toMatchObject({
			type: "driving_details_missing_reminder",
			title: "Add your driving details",
			message:
				"Your work on Sep 7, 2026 is missing its vehicle or an odometer reading. Add them to the work period.",
			entityType: "work_period",
			entityId: "work-1",
			actionUrl: "/time-tracking",
			idempotencyKey: "clocking-reminder:driving_details_missing_reminder:work_period:work-1",
			metadata: {
				i18n: {
					titleKey: "common:notifications.content.drivingDetailsMissingReminder.title",
					messageKey: "common:notifications.content.drivingDetailsMissingReminder.message",
				},
			},
		});
		expect(build("de").metadata?.i18n).toMatchObject({ params: { date: "07.09.2026" } });
	});
});

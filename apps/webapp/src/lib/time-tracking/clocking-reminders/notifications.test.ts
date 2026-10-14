import { describe, expect, it } from "vitest";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatNotificationParams } from "@/lib/notifications/notification-params";
import {
	buildClockingReminderNotification,
	buildDrivingDetailsReminderNotification,
} from "./notifications";

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
	function build() {
		const notification = buildClockingReminderNotification({
			reminder: overnight,
			organizationId: "org-1",
			userId: "user-1",
			timezone: "Europe/Berlin",
		});
		const i18n = notification.metadata?.i18n as {
			messageKey: string;
			params: Record<string, unknown>;
		};
		return { message: notification.message, i18n };
	}

	it("names the day whose required hours a policy forgotten clock-out was judged against", () => {
		const { message, i18n } = build();
		expect(message).toBe(
			"You reached the required hours for Monday, April 27 at 6:00 AM (Europe/Berlin). Clock out if you have finished working.",
		);
		expect(i18n).toMatchObject({
			messageKey: "common:notifications.content.policyForgottenClockOutReminder.message",
			params: { timezone: "Europe/Berlin" },
		});
	});

	it("stores the day and time as typed params, formatted in the reader's language on delivery (#1149)", () => {
		const { params } = build().i18n;
		expect(params).toMatchObject({
			day: { kind: "plainDate", date: "2026-04-27", preset: "weekdayMonthDayLong" },
			endTime: {
				kind: "zonedInstant",
				at: "2026-04-28T04:00:00Z",
				timeZone: "Europe/Berlin",
				preset: "time",
				printZone: false,
			},
		});
		expect(formatNotificationParams(params, { locale: "de" })).toMatchObject({
			day: "Montag, 27. April",
			endTime: expect.stringMatching(/^0?6:00$/),
		});
		expect(formatNotificationParams(params, { locale: "en", timeFormat: "24h" })).toMatchObject({
			endTime: expect.stringMatching(/^0?6:00$/),
		});
	});
});

describe("period submission reminder notifications", () => {
	function build(stage: "period_end" | "after_delay") {
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
					params: {
						startDate: { kind: "plainDate", date: "2026-03-02" },
						endDate: { kind: "plainDate", date: "2026-03-08" },
					},
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

	it("formats the period's dates in the reader's language on delivery", () => {
		const i18n = build("period_end").metadata?.i18n as { params: Record<string, unknown> };
		expect(formatNotificationParams(i18n.params, { locale: "de" })).toMatchObject({
			startDate: "2. März 2026",
			endDate: "8. März 2026",
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
					params: {
						startDate: { kind: "plainDate", date: "2026-03-02" },
						endDate: { kind: "plainDate", date: "2026-03-08" },
					},
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
	it("names the event-local day of the work lacking its vehicle or a reading", () => {
		const notification = buildClockingReminderNotification({
			reminder: {
				type: "driving_details_missing_reminder" as const,
				occasionKey: "driving_details_missing_reminder:work_period:work-1",
				day: parsePlainDate("2026-09-07"),
				expectedAt: at("2026-09-08T06:00:00Z"),
				shift: null,
				drivingWork: { workPeriodId: "work-1", workDay: parsePlainDate("2026-09-07") },
			},
			organizationId: "org-1",
			userId: "user-1",
			timezone: "Europe/Berlin",
		});
		expect(notification).toMatchObject({
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
					params: { date: { kind: "plainDate", date: "2026-09-07" } },
				},
			},
		});
		const i18n = notification.metadata?.i18n as { params: Record<string, unknown> };
		expect(formatNotificationParams(i18n.params, { locale: "de" })).toMatchObject({
			date: "7. Sept. 2026",
		});
	});

	it("lists every newly due work period in one reminder per morning (#807 decision 8)", () => {
		const due = (workPeriodId: string, workDay: string) => ({
			type: "driving_details_missing_reminder" as const,
			occasionKey: `driving_details_missing_reminder:work_period:${workPeriodId}`,
			day: parsePlainDate(workDay),
			expectedAt: at("2026-09-09T06:00:00Z"),
			shift: null,
			drivingWork: { workPeriodId, workDay: parsePlainDate(workDay) },
		});
		const notification = buildDrivingDetailsReminderNotification({
			reminders: [
				due("work-2", "2026-09-08"),
				due("work-1", "2026-09-07"),
				due("work-3", "2026-09-08"),
			],
			organizationId: "org-1",
			userId: "user-1",
			timezone: "Europe/Berlin",
		});

		expect(notification).toMatchObject({
			type: "driving_details_missing_reminder",
			title: "Add your driving details",
			actionUrl: "/time-tracking",
			idempotencyKey: "clocking-reminder:driving_details_missing_reminder:work_period:work-1",
			metadata: {
				occasionKeys: [
					"driving_details_missing_reminder:work_period:work-1",
					"driving_details_missing_reminder:work_period:work-2",
					"driving_details_missing_reminder:work_period:work-3",
				],
				workPeriodIds: ["work-1", "work-2", "work-3"],
				i18n: {
					titleKey: "common:notifications.content.drivingDetailsMissingReminder.title",
					messageKey: "common:notifications.content.drivingDetailsMissingReminderMany.message",
					params: {
						count: 3,
						dates: { kind: "plainDateRange", start: "2026-09-07", end: "2026-09-08" },
					},
				},
			},
		});
		expect(notification.message).toMatch(/^3 work periods from Sep 7\s*–\s*8, 2026 are missing/);
		expect(notification).not.toHaveProperty("entityId");
		const i18n = notification.metadata?.i18n as { params: Record<string, unknown> };
		expect(formatNotificationParams(i18n.params, { locale: "de" }).dates).toBe("7.–8. Sept. 2026");

		// One period: the single reminder, unchanged.
		expect(
			buildDrivingDetailsReminderNotification({
				reminders: [due("work-1", "2026-09-07")],
				organizationId: "org-1",
				userId: "user-1",
				timezone: "Europe/Berlin",
			}),
		).toMatchObject({
			message:
				"Your work on Sep 7, 2026 is missing its vehicle or an odometer reading. Add them to the work period.",
			entityId: "work-1",
		});
	});
});

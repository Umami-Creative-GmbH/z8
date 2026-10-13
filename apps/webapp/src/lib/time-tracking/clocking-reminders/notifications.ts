import type { Instant, PlainDate } from "@/lib/datetime/temporal-core";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import type { ClockingReminderType, DueClockingReminder } from "./occasion";

interface ReminderCopy {
	titleKey: string;
	titleDefault: string;
	messageKey: string;
	messageDefault: string;
}

// Each key sits next to its English default so the Tolgee extractor reads both.
const reminderCopy = {
	missed_clock_in_reminder: {
		titleKey: "common:notifications.content.missedClockInReminder.title",
		titleDefault: "You have not clocked in yet",
		messageKey: "common:notifications.content.missedClockInReminder.message",
		messageDefault: "Your shift started at {startTime} ({timezone}). Clock in if you are working.",
	},
	forgotten_clock_out_reminder: {
		titleKey: "common:notifications.content.forgottenClockOutReminder.title",
		titleDefault: "You are still clocked in",
		messageKey: "common:notifications.content.forgottenClockOutReminder.message",
		messageDefault:
			"Your shift ended at {endTime} ({timezone}). Clock out if you have finished working.",
	},
	break_due_reminder: {
		titleKey: "common:notifications.content.breakDueReminder.title",
		titleDefault: "Time for a break soon",
		messageKey: "common:notifications.content.breakDueReminder.message",
		messageDefault:
			"Your break is due at {breakTime} ({timezone}). Take a break by then to follow your work policy's break rules.",
	},
	period_submission_reminder: {
		titleKey: "common:notifications.content.periodSubmissionReminder.title",
		titleDefault: "Submit your time for approval",
		messageKey: "common:notifications.content.periodSubmissionReminder.message",
		messageDefault:
			"Your period {startDate} – {endDate} has ended. Review your time and submit it for approval.",
	},
	// A pending submission withdrawn after a change (#1062); an outdated approval has its own copy.
	period_submission_sent_back: {
		titleKey: "common:notifications.content.periodSubmissionWithdrawnAfterChange.title",
		titleDefault: "Submit your time again",
		messageKey: "common:notifications.content.periodSubmissionWithdrawnAfterChange.message",
		messageDefault:
			"Your time for {startDate} – {endDate} changed after you submitted it, so the submission was withdrawn. Review your time and submit it again.",
	},
	// An approved period (#805); a rejection has its own copy with the approver's reason.
	period_submission_decided: {
		titleKey: "common:notifications.content.periodSubmissionApproved.title",
		titleDefault: "Your time was approved",
		messageKey: "common:notifications.content.periodSubmissionApproved.message",
		messageDefault: "Your time for {startDate} – {endDate} was approved.",
	},
	// The morning after work lacking its vehicle or a reading, while vehicle use is expected (#1127).
	driving_details_missing_reminder: {
		titleKey: "common:notifications.content.drivingDetailsMissingReminder.title",
		titleDefault: "Add your driving details",
		messageKey: "common:notifications.content.drivingDetailsMissingReminder.message",
		messageDefault:
			"Your work on {date} is missing its vehicle or an odometer reading. Add them to the work period.",
	},
} as const satisfies Record<ClockingReminderType, Record<string, string>>;

/** A rejected period, with the approver's reason (#805). */
const periodSubmissionRejectedCopy = {
	titleKey: "common:notifications.content.periodSubmissionRejected.title",
	titleDefault: "Your time was rejected",
	messageKey: "common:notifications.content.periodSubmissionRejected.message",
	messageDefault:
		"Your time for {startDate} – {endDate} was rejected: {reason}. Review your time and submit it again.",
} as const satisfies ReminderCopy;

/** The second reminder of a period still unsubmitted after the organization's delay (#1064). */
const periodSubmissionSecondReminderCopy = {
	titleKey: "common:notifications.content.periodSubmissionSecondReminder.title",
	titleDefault: "Your time is still not submitted",
	messageKey: "common:notifications.content.periodSubmissionSecondReminder.message",
	messageDefault:
		"Your period {startDate} – {endDate} is still not submitted. Review your time and submit it for approval.",
} as const satisfies ReminderCopy;

/** An approved period whose approval went out of date after a change (#1062). */
const periodSubmissionOutdatedCopy = {
	titleKey: "common:notifications.content.periodSubmissionOutdated.title",
	titleDefault: "Your approved time is out of date",
	messageKey: "common:notifications.content.periodSubmissionOutdated.message",
	messageDefault:
		"Your time for {startDate} – {endDate} changed after it was approved. Review your time and submit it again.",
} as const satisfies ReminderCopy;

/**
 * Reminders judged by the work policy rather than a shift (#830) keep their type's title; the
 * message names the policy times instead.
 */
const policyMessageCopy = {
	missed_clock_in_reminder: {
		messageKey: "common:notifications.content.policyMissedClockInReminder.message",
		messageDefault:
			"Your latest clock-in today was {startTime} ({timezone}). Clock in if you are working.",
	},
	forgotten_clock_out_reminder: {
		messageKey: "common:notifications.content.policyForgottenClockOutReminder.message",
		messageDefault:
			"You reached the required hours for {day} at {endTime} ({timezone}). Clock out if you have finished working.",
	},
} as const satisfies Partial<
	Record<ClockingReminderType, Pick<ReminderCopy, "messageKey" | "messageDefault">>
>;

/** Several work periods lacking driving details, due the same morning (#807 decision 8). */
const drivingDetailsManyCopy = {
	titleKey: "common:notifications.content.drivingDetailsMissingReminder.title",
	titleDefault: "Add your driving details",
	messageKey: "common:notifications.content.drivingDetailsMissingReminderMany.message",
	messageDefault:
		"{count} work periods on {dates} are missing their vehicle or an odometer reading. Add them to the work periods.",
} as const satisfies ReminderCopy;

function formatTime(instant: Instant, locale: string, timezone: string): string {
	return instant.toLocaleString(locale, { timeStyle: "short", timeZone: timezone });
}

/**
 * The reminder as the employee receives it: English text plus the i18n keys and parameters, with
 * shift and break times shown in the employee's own timezone and locale.
 */
export function buildClockingReminderNotification(input: {
	reminder: DueClockingReminder;
	organizationId: string;
	userId: string;
	timezone: string;
	locale: string;
}): CreateNotificationParams {
	const { reminder, timezone, locale } = input;
	const params: Record<string, string> = { timezone };
	let copy: ReminderCopy = reminderCopy[reminder.type];
	const formatDate = (date: PlainDate) => date.toLocaleString(locale, { dateStyle: "medium" });
	if (reminder.type === "driving_details_missing_reminder") {
		params.date = formatDate(reminder.drivingWork?.workDay ?? reminder.day);
	} else if (reminder.type === "period_submission_decided") {
		const period = reminder.decidedPeriod;
		if (period?.outcome === "rejected") {
			copy = periodSubmissionRejectedCopy;
			params.reason = period.reason ?? "";
		}
		params.startDate = formatDate(period?.startDate ?? reminder.day);
		params.endDate = formatDate(period?.endDate ?? reminder.day);
	} else if (reminder.type === "period_submission_sent_back") {
		const period = reminder.sentBackPeriod;
		if (period?.outcome === "outdated") copy = periodSubmissionOutdatedCopy;
		params.startDate = formatDate(period?.startDate ?? reminder.day);
		params.endDate = formatDate(period?.endDate ?? reminder.day);
	} else if (reminder.type === "period_submission_reminder") {
		const period = reminder.submissionPeriod;
		if (period?.stage === "after_delay") copy = periodSubmissionSecondReminderCopy;
		params.startDate = formatDate(period?.startDate ?? reminder.day);
		params.endDate = formatDate(period?.endDate ?? reminder.day);
	} else if (reminder.shift) {
		params.startTime = formatTime(reminder.shift.start, locale, timezone);
		params.endTime = formatTime(reminder.shift.end, locale, timezone);
	} else if (reminder.type !== "break_due_reminder") {
		copy = { ...copy, ...policyMessageCopy[reminder.type] };
		const expected = formatTime(reminder.expectedAt, locale, timezone);
		if (reminder.type === "missed_clock_in_reminder") {
			params.startTime = expected;
		} else {
			params.endTime = expected;
			// Live work past midnight is judged against the day it started, which need not be today.
			params.day = reminder.day.toLocaleString(locale, {
				weekday: "long",
				month: "long",
				day: "numeric",
			});
		}
	}
	if (reminder.type === "break_due_reminder") {
		params.breakTime = formatTime(reminder.expectedAt, locale, timezone);
	}
	const render = (template: string) =>
		template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match);
	return {
		userId: input.userId,
		organizationId: input.organizationId,
		type: reminder.type,
		title: copy.titleDefault,
		message: render(copy.messageDefault),
		...(reminder.shift ? { entityType: "shift", entityId: reminder.shift.id } : {}),
		...(reminder.drivingWork
			? { entityType: "work_period", entityId: reminder.drivingWork.workPeriodId }
			: {}),
		actionUrl: "/time-tracking",
		idempotencyKey: `clocking-reminder:${reminder.occasionKey}`,
		metadata: {
			occasionKey: reminder.occasionKey,
			day: reminder.day.toString(),
			expectedAt: reminder.expectedAt.toString(),
			i18n: { ...copy, params },
		},
	};
}

/**
 * The one driving details reminder of an employee's morning (#1127, #807 decision 8): every
 * newly due work period lacking its vehicle or a reading, by their event-local dates. One period
 * keeps the single reminder; several name their count and dates. The same text feeds the in-app
 * notification, the email and the push message.
 */
export function buildDrivingDetailsReminderNotification(input: {
	reminders: readonly DueClockingReminder[];
	organizationId: string;
	userId: string;
	timezone: string;
	locale: string;
}): CreateNotificationParams {
	const workDayOf = (reminder: DueClockingReminder) =>
		reminder.drivingWork?.workDay ?? reminder.day;
	const reminders = [...input.reminders].sort(
		(left, right) =>
			workDayOf(left).toString().localeCompare(workDayOf(right).toString()) ||
			left.occasionKey.localeCompare(right.occasionKey),
	);
	const [first] = reminders;
	if (!first) throw new Error("A driving details reminder needs at least one work period");
	if (reminders.length === 1) {
		return buildClockingReminderNotification({ ...input, reminder: first });
	}
	const { locale } = input;
	const days = new Map(
		reminders.map((reminder) => [workDayOf(reminder).toString(), workDayOf(reminder)]),
	);
	const dates = new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(
		[...days.values()].map((day) => day.toLocaleString(locale, { dateStyle: "medium" })),
	);
	const params: Record<string, string> = { count: String(reminders.length), dates };
	const copy = drivingDetailsManyCopy;
	return {
		userId: input.userId,
		organizationId: input.organizationId,
		type: "driving_details_missing_reminder",
		title: copy.titleDefault,
		message: copy.messageDefault.replace(
			/\{(\w+)\}/g,
			(match, name: string) => params[name] ?? match,
		),
		actionUrl: "/time-tracking",
		// Each work period is claimed once, so the first one's key names this reminder for good.
		idempotencyKey: `clocking-reminder:${first.occasionKey}`,
		metadata: {
			occasionKeys: reminders.map((reminder) => reminder.occasionKey),
			workPeriodIds: reminders.flatMap((reminder) =>
				reminder.drivingWork ? [reminder.drivingWork.workPeriodId] : [],
			),
			expectedAt: first.expectedAt.toString(),
			i18n: { ...copy, params },
		},
	};
}

import type { VacationOverrideSummary } from "@/lib/absences/sick-vacation-override";
import { type Instant, parsePlainDate, plainDateAt } from "@/lib/datetime/temporal-core";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import { formatAbsenceDateRange } from "@/lib/personnel-file/sick-note-labels";
import type { AbsenceDeputyNotificationType } from "./deputy-notification-types";

/**
 * What an absence's deputy is told (#1013, spec #802): they were named, are no
 * longer named, the dates changed, and the day before the cover starts. Only
 * an approved absence names its deputy; a pending one may still be rejected.
 * The copy shows the absent person and the dates, never the category or any
 * sick detail. Pure: the server side lives in `deputy-notifier.ts`.
 */

/** An absence as its deputy notifications see it, read after the write committed. */
export interface DeputyAbsenceFacts {
	id: string;
	employeeId: string;
	deputyEmployeeId: string | null;
	startDate: string;
	endDate: string;
	status: "pending" | "approved" | "rejected";
}

/** A committed absence write, as far as the deputies are concerned. */
export type AbsenceDeputyEvent =
	/** The absence was approved, or created approved (no approval needed, recorded, auto-completed). */
	| { kind: "approved"; absenceId: string }
	/** A sick absence shortened, split or rejected overlapping vacations. */
	| { kind: "vacation_override"; summary: VacationOverrideSummary }
	| {
			kind: "deputy_changed";
			absenceId: string;
			/** Unique per change, so naming the same deputy again is told again. */
			changeId: string;
			from: string | null;
			to: string | null;
	  }
	/** The absence was cancelled (deleted); its facts as they were before. */
	| { kind: "cancelled"; absence: DeputyAbsenceFacts };

export type DeputyNoticeKind = "assigned" | "removed" | "dates_changed";

export interface DeputyNotice {
	kind: DeputyNoticeKind;
	absence: DeputyAbsenceFacts;
	deputyEmployeeId: string;
	/** Tells this notice apart from earlier ones of the same kind in its idempotency key. */
	occasion: string;
}

/** The absences whose committed state the events need. */
export function absenceIdsOfEvents(events: readonly AbsenceDeputyEvent[]): string[] {
	const ids = new Set<string>();
	for (const event of events) {
		switch (event.kind) {
			case "approved":
			case "deputy_changed":
				ids.add(event.absenceId);
				break;
			case "vacation_override":
				for (const id of [
					...event.summary.updatedAbsenceIds,
					...event.summary.createdAbsenceIds,
					...(event.summary.overriddenApprovedAbsenceIds ?? []),
				]) {
					ids.add(id);
				}
				break;
			case "cancelled":
				break;
		}
	}
	return [...ids];
}

function namedOn(absence: DeputyAbsenceFacts | undefined): absence is DeputyAbsenceFacts & {
	deputyEmployeeId: string;
} {
	return absence?.status === "approved" && absence.deputyEmployeeId !== null;
}

/**
 * The notices the committed events call for, given the absences' committed
 * state. Nothing is said about a pending absence; each deputy hears about
 * one occasion once.
 */
export function planDeputyNotices(
	events: readonly AbsenceDeputyEvent[],
	absences: ReadonlyMap<string, DeputyAbsenceFacts>,
): DeputyNotice[] {
	const notices = new Map<string, DeputyNotice>();
	const add = (notice: DeputyNotice) => {
		const key = deputyNoticeKey(notice);
		if (!notices.has(key)) notices.set(key, notice);
	};
	for (const event of events) {
		switch (event.kind) {
			case "approved": {
				const absence = absences.get(event.absenceId);
				if (namedOn(absence)) {
					add({
						kind: "assigned",
						absence,
						deputyEmployeeId: absence.deputyEmployeeId,
						occasion: "approved",
					});
				}
				break;
			}
			case "vacation_override": {
				for (const id of event.summary.updatedAbsenceIds) {
					const absence = absences.get(id);
					if (namedOn(absence)) {
						add({
							kind: "dates_changed",
							absence,
							deputyEmployeeId: absence.deputyEmployeeId,
							occasion: `dates:${absence.startDate}:${absence.endDate}`,
						});
					}
				}
				for (const id of event.summary.createdAbsenceIds) {
					const absence = absences.get(id);
					if (namedOn(absence)) {
						add({
							kind: "assigned",
							absence,
							deputyEmployeeId: absence.deputyEmployeeId,
							occasion: "approved",
						});
					}
				}
				for (const id of event.summary.overriddenApprovedAbsenceIds ?? []) {
					const absence = absences.get(id);
					if (absence?.status === "rejected" && absence.deputyEmployeeId) {
						add({
							kind: "removed",
							absence,
							deputyEmployeeId: absence.deputyEmployeeId,
							occasion: "rejected",
						});
					}
				}
				break;
			}
			case "deputy_changed": {
				const absence = absences.get(event.absenceId);
				if (absence?.status !== "approved" || event.from === event.to) break;
				const occasion = `change:${event.changeId}`;
				if (event.from) {
					add({ kind: "removed", absence, deputyEmployeeId: event.from, occasion });
				}
				if (event.to) {
					add({ kind: "assigned", absence, deputyEmployeeId: event.to, occasion });
				}
				break;
			}
			case "cancelled": {
				if (namedOn(event.absence)) {
					add({
						kind: "removed",
						absence: event.absence,
						deputyEmployeeId: event.absence.deputyEmployeeId,
						occasion: "cancelled",
					});
				}
				break;
			}
		}
	}
	return [...notices.values()];
}

const NOTICE_TYPES: Record<DeputyNoticeKind, AbsenceDeputyNotificationType> = {
	assigned: "absence_deputy_assigned",
	removed: "absence_deputy_removed",
	dates_changed: "absence_deputy_dates_changed",
};

function deputyNoticeKey(notice: DeputyNotice): string {
	return `absence-deputy-${notice.kind.replace("_", "-")}:${notice.absence.id}:${notice.deputyEmployeeId}:${notice.occasion}`;
}

const NOTICE_COPY = {
	assigned: {
		titleKey: "common:notifications.content.absenceDeputyAssigned.title",
		titleDefault: "You're an absence deputy",
		messageKey: "common:notifications.content.absenceDeputyAssigned.message",
		messageDefault: "You're covering for {name} ({dateRange}).",
	},
	removed: {
		titleKey: "common:notifications.content.absenceDeputyRemoved.title",
		titleDefault: "You're no longer an absence deputy",
		messageKey: "common:notifications.content.absenceDeputyRemoved.message",
		messageDefault: "You no longer cover for {name} ({dateRange}).",
	},
	dates_changed: {
		titleKey: "common:notifications.content.absenceDeputyDatesChanged.title",
		titleDefault: "Absence deputy dates changed",
		messageKey: "common:notifications.content.absenceDeputyDatesChanged.message",
		messageDefault: "Your cover for {name} now runs {dateRange}.",
	},
} as const satisfies Record<DeputyNoticeKind, unknown>;

const reminderCopy = {
	titleKey: "common:notifications.content.absenceDeputyReminder.title",
	titleDefault: "Absence cover starts tomorrow",
	messageKey: "common:notifications.content.absenceDeputyReminder.message",
	messageDefault: "From tomorrow you're covering for {name} until {untilDate}.",
} as const;

/** The deputy's dashboard shows whom they cover. */
export const DEPUTY_NOTIFICATION_PATH = "/";

/** The stored message's date format; readers get theirs from the plain days in metadata. */
const NOTIFICATION_DATE_LOCALE = "en-GB";

function fill(template: string, params: Record<string, string>): string {
	return Object.entries(params).reduce(
		(text, [key, value]) => text.replace(`{${key}}`, value),
		template,
	);
}

export function buildDeputyNotification(input: {
	organizationId: string;
	recipientUserId: string;
	absentName: string;
	notice: DeputyNotice;
}): CreateNotificationParams {
	const { absence } = input.notice;
	const copy = NOTICE_COPY[input.notice.kind];
	const params = {
		name: input.absentName,
		dateRange: formatAbsenceDateRange(absence.startDate, absence.endDate, NOTIFICATION_DATE_LOCALE),
	};
	return {
		userId: input.recipientUserId,
		organizationId: input.organizationId,
		type: NOTICE_TYPES[input.notice.kind],
		title: copy.titleDefault,
		message: fill(copy.messageDefault, params),
		actionUrl: DEPUTY_NOTIFICATION_PATH,
		idempotencyKey: deputyNoticeKey(input.notice),
		metadata: {
			absenceId: absence.id,
			absentEmployeeId: absence.employeeId,
			dateRangeDays: { startDate: absence.startDate, endDate: absence.endDate },
			i18n: { ...copy, params },
		},
	};
}

export function buildDeputyReminderNotification(input: {
	organizationId: string;
	recipientUserId: string;
	absentName: string;
	absence: Pick<DeputyAbsenceFacts, "id" | "employeeId" | "startDate" | "endDate">;
	deputyEmployeeId: string;
}): CreateNotificationParams {
	const { absence } = input;
	const params = {
		name: input.absentName,
		untilDate: formatAbsenceDateRange(absence.endDate, absence.endDate, NOTIFICATION_DATE_LOCALE),
	};
	return {
		userId: input.recipientUserId,
		organizationId: input.organizationId,
		type: "absence_deputy_reminder",
		title: reminderCopy.titleDefault,
		message: fill(reminderCopy.messageDefault, params),
		actionUrl: DEPUTY_NOTIFICATION_PATH,
		idempotencyKey: `absence-deputy-reminder:${absence.id}:${input.deputyEmployeeId}:${absence.startDate}`,
		metadata: {
			absenceId: absence.id,
			absentEmployeeId: absence.employeeId,
			untilDay: absence.endDate,
			i18n: { ...reminderCopy, params },
		},
	};
}

/**
 * Whether today, in the absent employee's effective timezone, is the day
 * before the absence starts.
 */
export function isDeputyReminderDue(input: {
	startDate: string;
	timezone: string;
	now: Instant;
}): boolean {
	return plainDateAt(input.now, input.timezone)
		.add({ days: 1 })
		.equals(parsePlainDate(input.startDate));
}

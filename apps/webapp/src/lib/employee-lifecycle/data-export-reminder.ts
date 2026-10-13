/**
 * Pre-departure personal data reminder (#1173, spec #811). Personal data
 * self-service ends at the departure cutoff; afterwards only an admin export
 * reaches the employee (Organization ADR 0003). So recording a departure with
 * a future cutoff queues one `notify_data_export_reminder` task, and the
 * worker tells the departing employee, in-app and by email, to download their
 * data on My data before the cutoff day.
 */
import { and, eq, sql } from "drizzle-orm";
import type { db as rootDatabase } from "@/db";
import { user } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { employeeDeparture, employeeDepartureTask } from "@/db/schema/employee-lifecycle";
import { isReservedEmail } from "@/lib/auth/reserved-email";
import {
	type Clock,
	compareInstants,
	type Instant,
	instantFromDate,
	parseInstant,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import { MY_DATA_PATH } from "@/lib/personal-data-export/paths";
import { departureCutoffDate } from "./cutoff-display";
import { type DepartureTaskHandler, DepartureTaskNeedsResolutionError } from "./delivery";
import type { LifecycleClient } from "./types";

export const DATA_EXPORT_REMINDER_NOTIFICATION_TYPE = "personal_data_export_reminder" as const;

// Full ICU defaults spelled out so the Tolgee extractor pushes the whole message.
const COPY = {
	titleKey: "common:notifications.content.personalDataExportReminder.title",
	titleDefault: "Download your personal data before you leave",
	messageKey: "common:notifications.content.personalDataExportReminder.message",
	messageDefault:
		"Download your personal data on My data before {untilDate}. After that, only an administrator can export it for you.",
} as const;

/**
 * Queues the reminder for a departure revision whose cutoff is new: a newly
 * recorded departure, or an edit that moved the cutoff. Re-saving with the
 * same cutoff queues nothing, so the employee is never told twice.
 */
export async function queueDataExportReminder(
	tx: LifecycleClient,
	input: {
		organizationId: string;
		employeeId: string;
		employmentPeriodId: string;
		departureId: string;
		revision: number;
		cutoff: Instant;
		previousCutoff: Instant | null;
		now: Instant;
	},
): Promise<void> {
	if (input.previousCutoff?.equals(input.cutoff)) return;
	if (compareInstants(input.cutoff, input.now) <= 0) return;
	await tx
		.insert(employeeDepartureTask)
		.values({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			employmentPeriodId: input.employmentPeriodId,
			departureId: input.departureId,
			kind: "notify_data_export_reminder",
			dedupeKey: `data-export-reminder:${input.departureId}:${input.revision}`,
			payload: { revision: input.revision, cutoffAt: input.cutoff.toString() },
		})
		.onConflictDoNothing();
}

/**
 * "Download your personal data before <cutoff day>". The day is the cutoff's
 * calendar day in the zone frozen on the departure (the organization's), so
 * every reader sees the same date; in-app re-formats it in the reader's
 * locale from `untilDay`.
 */
export function buildDataExportReminderNotification(input: {
	organizationId: string;
	recipientUserId: string;
	departureId: string;
	revision: number;
	cutoff: Instant;
	timezone: string;
	locale: string;
}): CreateNotificationParams {
	const untilDay = departureCutoffDate(input.cutoff, input.timezone);
	const untilDate = formatPlainDate(parsePlainDate(untilDay), input.locale, "dateMedium");
	return {
		userId: input.recipientUserId,
		organizationId: input.organizationId,
		type: DATA_EXPORT_REMINDER_NOTIFICATION_TYPE,
		title: COPY.titleDefault,
		message: `Download your personal data on My data before ${untilDate}. After that, only an administrator can export it for you.`,
		entityType: "employee_departure",
		entityId: input.departureId,
		actionUrl: MY_DATA_PATH,
		idempotencyKey: `personal-data-export-reminder:${input.departureId}:${input.revision}:${input.recipientUserId}`,
		metadata: {
			departureId: input.departureId,
			untilDay,
			i18n: { ...COPY, params: { untilDate } },
		},
	};
}

export type DataExportReminderTransport = {
	send(params: CreateNotificationParams): Promise<unknown>;
	locale(input: { userId: string; organizationId: string }): Promise<string>;
};

type ReminderDatabase = Pick<typeof rootDatabase, "select">;

function payloadOf(payload: Record<string, unknown>): { revision: number; cutoff: Instant } | null {
	const { revision, cutoffAt } = payload;
	if (typeof revision !== "number" || !Number.isInteger(revision)) return null;
	if (typeof cutoffAt !== "string") return null;
	try {
		return { revision, cutoff: parseInstant(cutoffAt) };
	} catch {
		return null;
	}
}

/**
 * Delivers a `notify_data_export_reminder` task. It sends only while the
 * reminder is still true: the departure is pending with the same cutoff, the
 * cutoff is ahead, no later reminder supersedes it, and the employee can still
 * sign in. Kiosk-only employees are skipped; their notifications would be
 * forwarded to managers, and they cannot use My data.
 */
export function createDataExportReminderHandler(deps: {
	database: ReminderDatabase;
	clock: Clock;
	transport: DataExportReminderTransport;
}): DepartureTaskHandler {
	return async (claim, context) => {
		const payload = payloadOf(claim.payload);
		if (!payload || !claim.departureId) {
			throw new DepartureTaskNeedsResolutionError("invalid_notification_payload");
		}
		const [departure] = await deps.database
			.select({
				status: employeeDeparture.status,
				cutoffAt: employeeDeparture.cutoffAt,
				timezone: employeeDeparture.timezone,
			})
			.from(employeeDeparture)
			.where(
				and(
					eq(employeeDeparture.organizationId, claim.organizationId),
					eq(employeeDeparture.employeeId, claim.employeeId),
					eq(employeeDeparture.id, claim.departureId),
				),
			)
			.limit(1);
		const cutoff = departure ? instantFromDate(departure.cutoffAt) : null;
		if (
			!departure ||
			!cutoff ||
			departure.status !== "pending" ||
			!cutoff.equals(payload.cutoff) ||
			compareInstants(cutoff, deps.clock.nowInstant()) <= 0
		) {
			await context.recordProgress({ outcome: "obsolete" });
			return;
		}

		const [newer] = await deps.database
			.select({ id: employeeDepartureTask.id })
			.from(employeeDepartureTask)
			.where(
				and(
					eq(employeeDepartureTask.organizationId, claim.organizationId),
					eq(employeeDepartureTask.departureId, claim.departureId),
					eq(employeeDepartureTask.kind, "notify_data_export_reminder"),
					sql`(${employeeDepartureTask.payload}->>'revision')::int > ${payload.revision}`,
				),
			)
			.limit(1);
		if (newer) {
			await context.recordProgress({ outcome: "superseded" });
			return;
		}

		const [recipient] = await deps.database
			.select({ userId: employee.userId, isActive: employee.isActive, email: user.email })
			.from(employee)
			.innerJoin(user, eq(user.id, employee.userId))
			.where(
				and(eq(employee.organizationId, claim.organizationId), eq(employee.id, claim.employeeId)),
			)
			.limit(1);
		if (!recipient?.isActive) {
			await context.recordProgress({ outcome: "employee_inactive" });
			return;
		}
		if (isReservedEmail(recipient.email)) {
			await context.recordProgress({ outcome: "kiosk_only" });
			return;
		}

		const locale = await deps.transport.locale({
			userId: recipient.userId,
			organizationId: claim.organizationId,
		});
		await deps.transport.send(
			buildDataExportReminderNotification({
				organizationId: claim.organizationId,
				recipientUserId: recipient.userId,
				departureId: claim.departureId,
				revision: payload.revision,
				cutoff,
				timezone: departure.timezone,
				locale,
			}),
		);
		await context.recordProgress({ outcome: "sent" });
	};
}

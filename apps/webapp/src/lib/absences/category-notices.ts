import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { absenceCategory, absenceCategoryNotice } from "@/db/schema";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { memberIsAccessibleOwnerOrAdmin } from "@/lib/employee-lifecycle/authority-sql";
import { createLogger } from "@/lib/logger";
import { insertInAppNotification } from "@/lib/notifications/notification-service";
import type { CreateNotificationParams } from "@/lib/notifications/types";

/**
 * One-time notices that a built-in absence category is available (#1000). Migration 0187
 * gave every organization that existed then the time-off-in-lieu category inactive, with
 * one pending notice. Delivering a notice tells each owner and admin of its organization
 * once, in-app; the idempotency key keeps a retried delivery from telling anyone twice.
 */

const logger = createLogger("AbsenceCategoryNotices");

type Database = Pick<typeof appDb, "execute" | "select" | "update">;

export const ABSENCE_SETTINGS_PATH = "/settings/vacation";

const timeOffInLieuCopy = {
	titleKey: "common:notifications.content.timeOffInLieuAvailable.title",
	titleDefault: "Time off in lieu is available",
	messageKey: "common:notifications.content.timeOffInLieuAvailable.message",
	messageDefault:
		"Employees can now take time off against their work balance. The new absence category stays inactive until you turn it on in the absence settings.",
} as const;

export function buildTimeOffInLieuAvailableNotification(input: {
	organizationId: string;
	recipientUserId: string;
	categoryId: string;
}): CreateNotificationParams {
	return {
		userId: input.recipientUserId,
		organizationId: input.organizationId,
		type: "time_off_in_lieu_available",
		title: timeOffInLieuCopy.titleDefault,
		message: timeOffInLieuCopy.messageDefault,
		actionUrl: ABSENCE_SETTINGS_PATH,
		idempotencyKey: `absence-category-available:${input.categoryId}:${input.recipientUserId}`,
		metadata: { categoryId: input.categoryId, i18n: { ...timeOffInLieuCopy } },
	};
}

async function ownersAndAdmins(database: Database, organizationId: string, now: Instant) {
	const result = await database.execute<{ user_id: string }>(sql`
		SELECT DISTINCT m.user_id FROM member m
		WHERE m.organization_id = ${organizationId}
			AND ${memberIsAccessibleOwnerOrAdmin(sql`${dateFromInstant(now)}::timestamptz`)}
	`);
	return result.rows.map((row) => row.user_id);
}

export interface AbsenceCategoryNoticesResult {
	notices: number;
	notified: number;
}

/** Delivers every pending notice. One organization's failure does not stop the others. */
export async function deliverAbsenceCategoryNotices(
	database: Database,
	options: { now?: Instant } = {},
): Promise<AbsenceCategoryNoticesResult> {
	const now = options.now ?? systemClock.nowInstant();
	const pending = await database
		.select({
			id: absenceCategoryNotice.id,
			organizationId: absenceCategoryNotice.organizationId,
			categoryId: absenceCategoryNotice.categoryId,
			type: absenceCategory.type,
		})
		.from(absenceCategoryNotice)
		.innerJoin(
			absenceCategory,
			and(
				eq(absenceCategory.id, absenceCategoryNotice.categoryId),
				eq(absenceCategory.organizationId, absenceCategoryNotice.organizationId),
			),
		)
		.where(isNull(absenceCategoryNotice.deliveredAt))
		.orderBy(asc(absenceCategoryNotice.createdAt));

	const result: AbsenceCategoryNoticesResult = { notices: 0, notified: 0 };
	// One tenant at a time keeps failures and notification load isolated.
	// react-doctor-disable-next-line react-doctor/async-await-in-loop
	for (const notice of pending) {
		try {
			if (notice.type === "time_off_in_lieu") {
				const recipients = await ownersAndAdmins(database, notice.organizationId, now);
				for (const recipientUserId of recipients) {
					const inserted = await insertInAppNotification(
						buildTimeOffInLieuAvailableNotification({
							organizationId: notice.organizationId,
							recipientUserId,
							categoryId: notice.categoryId,
						}),
					);
					if (inserted.kind === "created") result.notified += 1;
				}
			}
			await database
				.update(absenceCategoryNotice)
				.set({ deliveredAt: dateFromInstant(now) })
				.where(
					and(
						eq(absenceCategoryNotice.id, notice.id),
						eq(absenceCategoryNotice.organizationId, notice.organizationId),
					),
				);
			result.notices += 1;
		} catch (error) {
			logger.error(
				{ error, organizationId: notice.organizationId, noticeId: notice.id },
				"Absence category notice failed",
			);
		}
	}
	return result;
}

import "server-only";

import { and, eq, exists, gt, lt, notExists, or, type SQL, sql } from "drizzle-orm";
import { alias, type PgColumn } from "drizzle-orm/pg-core";
import {
	positionConsent,
	positionNotice,
	positionNoticeDecline,
	positionStamp,
	positionStampAccessLog,
} from "@/db/schema";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import type { PositionCaptureClient } from "./store";

export type PositionRecordRetentionResult = {
	accessLogEntries: number;
	consents: number;
	declines: number;
};

type RetentionClient = Pick<PositionCaptureClient, "select" | "delete">;

/**
 * Deletes the position records that follow the audit-log lifetime (spec #766,
 * "Retention"): they hold no position, so the stamp purge (#829) never touches
 * them. A maintenance job across all tenants, like the audit-log cleanup it
 * runs with; it reads nothing and returns only counts. Notice versions stay as
 * the works council's history.
 *
 * - Access-log entries older than the lifetime, with their subjects. The
 *   append-only guard (migration 0145) lets only these deletes through.
 * - Consents out of force for longer than the lifetime: lapsed by a newer
 *   notice published before the cutoff, or withdrawn before it. A withdrawal
 *   that is still the employee's latest answer to the current notice stays, so
 *   the consent dialog does not ask again. A consent that still has a stamp
 *   stays until the purge has deleted it, so this never deletes a position.
 * - Declines ("Not now") of notices superseded before the cutoff. A decline of
 *   the current notice is the employee's answer to it and stays.
 */
export async function deletePositionRecordsPastAuditLifetime(
	db: RetentionClient,
	input: { now: Instant; lifetimeDays: number },
): Promise<PositionRecordRetentionResult> {
	const cutoff = dateFromInstant(input.now.subtract({ hours: input.lifetimeDays * 24 }));

	const accessLogEntries = await db
		.delete(positionStampAccessLog)
		.where(lt(positionStampAccessLog.accessedAt, cutoff))
		.returning({ id: positionStampAccessLog.id });

	const laterConsent = alias(positionConsent, "later_consent");
	const consents = await db
		.delete(positionConsent)
		.where(
			and(
				or(
					noticeSuperseded(db, positionConsent.noticeId, positionConsent.organizationId, cutoff),
					and(
						lt(positionConsent.withdrawnAt, cutoff),
						or(
							noticeSuperseded(db, positionConsent.noticeId, positionConsent.organizationId),
							exists(
								db
									.select({ one: sql`1` })
									.from(laterConsent)
									.where(
										and(
											eq(laterConsent.organizationId, positionConsent.organizationId),
											eq(laterConsent.employeeId, positionConsent.employeeId),
											eq(laterConsent.noticeId, positionConsent.noticeId),
											gt(laterConsent.grantedAt, positionConsent.grantedAt),
										),
									),
							),
						),
					),
				),
				notExists(
					db
						.select({ one: sql`1` })
						.from(positionStamp)
						.where(
							and(
								eq(positionStamp.organizationId, positionConsent.organizationId),
								eq(positionStamp.consentId, positionConsent.id),
							),
						),
				),
			),
		)
		.returning({ id: positionConsent.id });

	const declines = await db
		.delete(positionNoticeDecline)
		.where(
			noticeSuperseded(
				db,
				positionNoticeDecline.noticeId,
				positionNoticeDecline.organizationId,
				cutoff,
			),
		)
		.returning({ id: positionNoticeDecline.id });

	return {
		accessLogEntries: accessLogEntries.length,
		consents: consents.length,
		declines: declines.length,
	};
}

/**
 * Whether a newer version of the record's notice was published (before
 * `before`, when given): from then on the record no longer answers the current
 * notice.
 */
function noticeSuperseded(
	db: RetentionClient,
	noticeId: PgColumn,
	organizationId: PgColumn,
	before?: Date,
): SQL {
	const notice = alias(positionNotice, "record_notice");
	const newer = alias(positionNotice, "newer_notice");
	return exists(
		db
			.select({ one: sql`1` })
			.from(notice)
			.innerJoin(
				newer,
				and(eq(newer.organizationId, notice.organizationId), gt(newer.version, notice.version)),
			)
			.where(
				and(
					eq(notice.id, noticeId),
					eq(notice.organizationId, organizationId),
					before ? lt(newer.createdAt, before) : undefined,
				),
			),
	);
}

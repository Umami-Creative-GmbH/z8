/**
 * Position stamps category of a personal data export (#811, #1170): the
 * employee's stamps with coordinates, their consent history (consents and
 * "not now" answers, with the notice version they answered) and the access
 * log of who was shown their positions, and when. No withheld data: both
 * kinds of export hold the same rows.
 *
 * An access-log entry covers several employees and work periods; only the
 * employee's own work periods are exported, never another subject.
 *
 * An admin export that contains stamps is itself an access (#831 D4): it
 * writes one `data_export` access-log entry naming the requesting admin, in
 * the same transaction as the read. The employee's own export writes none.
 */

import { and, asc, eq, exists, inArray } from "drizzle-orm";
import {
	positionConsent,
	positionNotice,
	positionNoticeDecline,
	positionStamp,
	positionStampAccessLog,
	positionStampAccessLogSubject,
	timeEntry,
	workPeriod,
} from "@/db/schema";
import { systemClock } from "@/lib/datetime/temporal-core";
import { recordPositionStampAccess } from "@/lib/time-tracking/position-capture/access-log";
import type { PositionCaptureClient } from "@/lib/time-tracking/position-capture/store";
import {
	type CollectedCategory,
	type PersonalDataCollector,
	type PersonalDataExportDatabase,
	type PersonalDataExportScope,
	type PersonalDataRow,
	tablePart,
} from "../collector";
import { instantText, loadUserNames, nameOf } from "../values";
import { positionStampsFieldGuide } from "./position-stamps-fields";

/** Reads with the global client or inside the collector's transaction. */
type Reader = Pick<PersonalDataExportDatabase, "select">;

const STAMP_COLUMNS = [
	"time_entry_id",
	"clock_event",
	"latitude",
	"longitude",
	"accuracy_meters",
	"fixed_at",
	"captured_at",
	"utc_offset_minutes",
	"purge_at",
	"consent_id",
	"created_at",
] as const;

const CONSENT_COLUMNS = [
	"consent_id",
	"notice_version",
	"purpose_statement",
	"retention_days",
	"granted_at",
	"withdrawn_at",
] as const;

const DECLINE_COLUMNS = [
	"notice_version",
	"purpose_statement",
	"retention_days",
	"declined_at",
] as const;

const ACCESS_LOG_COLUMNS = [
	"accessed_at",
	"kind",
	"viewer",
	"work_period_id",
	"work_period_started_at",
	"work_period_utc_offset_minutes",
	"export_id",
] as const;

export const positionStampsCollector: PersonalDataCollector = {
	category: "position_stamps",
	collect: (database, scope) =>
		database.transaction(async (tx) => {
			const category = await collectPositionStamps(tx, scope);
			const stamps = category.parts.find((part) => part.key === "stamps");
			if (stamps?.kind === "table" && stamps.rows.length > 0) {
				await logAdminExportAccess(tx, scope);
			}
			return category;
		}),
	fields: positionStampsFieldGuide,
};

async function collectPositionStamps(
	database: Reader,
	scope: PersonalDataExportScope,
): Promise<CollectedCategory> {
	const { organizationId, employeeId } = scope;

	const stamps = await database
		.select({
			timeEntryId: positionStamp.timeEntryId,
			clockEvent: timeEntry.type,
			latitude: positionStamp.latitude,
			longitude: positionStamp.longitude,
			accuracyMeters: positionStamp.accuracyMeters,
			fixedAt: positionStamp.fixedAt,
			capturedAt: positionStamp.capturedAt,
			utcOffsetMinutes: timeEntry.utcOffsetMinutes,
			purgeAt: positionStamp.purgeAt,
			consentId: positionStamp.consentId,
			createdAt: positionStamp.createdAt,
		})
		.from(positionStamp)
		.innerJoin(
			timeEntry,
			and(
				eq(timeEntry.id, positionStamp.timeEntryId),
				eq(timeEntry.organizationId, organizationId),
			),
		)
		.where(
			and(
				eq(positionStamp.organizationId, organizationId),
				eq(positionStamp.employeeId, employeeId),
			),
		)
		.orderBy(asc(positionStamp.capturedAt), asc(positionStamp.id));

	const consents = await database
		.select({
			id: positionConsent.id,
			version: positionNotice.version,
			purposeStatement: positionNotice.purposeStatement,
			retentionDays: positionNotice.retentionDays,
			grantedAt: positionConsent.grantedAt,
			withdrawnAt: positionConsent.withdrawnAt,
		})
		.from(positionConsent)
		.innerJoin(
			positionNotice,
			and(
				eq(positionNotice.id, positionConsent.noticeId),
				eq(positionNotice.organizationId, organizationId),
			),
		)
		.where(
			and(
				eq(positionConsent.organizationId, organizationId),
				eq(positionConsent.employeeId, employeeId),
			),
		)
		.orderBy(asc(positionConsent.grantedAt), asc(positionConsent.id));

	const declines = await database
		.select({
			version: positionNotice.version,
			purposeStatement: positionNotice.purposeStatement,
			retentionDays: positionNotice.retentionDays,
			declinedAt: positionNoticeDecline.declinedAt,
		})
		.from(positionNoticeDecline)
		.innerJoin(
			positionNotice,
			and(
				eq(positionNotice.id, positionNoticeDecline.noticeId),
				eq(positionNotice.organizationId, organizationId),
			),
		)
		.where(
			and(
				eq(positionNoticeDecline.organizationId, organizationId),
				eq(positionNoticeDecline.employeeId, employeeId),
			),
		)
		.orderBy(asc(positionNoticeDecline.declinedAt), asc(positionNoticeDecline.id));

	return {
		category: "position_stamps",
		parts: [
			tablePart(
				"stamps",
				STAMP_COLUMNS,
				stamps.map((stamp) => ({
					time_entry_id: stamp.timeEntryId,
					clock_event: stamp.clockEvent,
					latitude: stamp.latitude,
					longitude: stamp.longitude,
					accuracy_meters: stamp.accuracyMeters,
					fixed_at: instantText(stamp.fixedAt),
					captured_at: instantText(stamp.capturedAt),
					utc_offset_minutes: stamp.utcOffsetMinutes,
					purge_at: instantText(stamp.purgeAt),
					consent_id: stamp.consentId,
					created_at: instantText(stamp.createdAt),
				})),
			),
			tablePart(
				"consents",
				CONSENT_COLUMNS,
				consents.map((consent) => ({
					consent_id: consent.id,
					notice_version: consent.version,
					purpose_statement: consent.purposeStatement,
					retention_days: consent.retentionDays,
					granted_at: instantText(consent.grantedAt),
					withdrawn_at: instantText(consent.withdrawnAt),
				})),
			),
			tablePart(
				"notice_declines",
				DECLINE_COLUMNS,
				declines.map((decline) => ({
					notice_version: decline.version,
					purpose_statement: decline.purposeStatement,
					retention_days: decline.retentionDays,
					declined_at: instantText(decline.declinedAt),
				})),
			),
			tablePart("access_log", ACCESS_LOG_COLUMNS, await accessLogRows(database, scope)),
		],
	};
}

/**
 * Every access-log entry covering the employee, oldest first: one row per own
 * work period shown (one row for an export). Other subjects and their work
 * periods are dropped. The whole log is read; it is pruned at the audit-log
 * lifetime, so it stays small per employee.
 */
async function accessLogRows(
	database: Reader,
	scope: PersonalDataExportScope,
): Promise<PersonalDataRow[]> {
	const { organizationId, employeeId } = scope;
	const entries = await database
		.select({
			kind: positionStampAccessLog.kind,
			accessedAt: positionStampAccessLog.accessedAt,
			viewerUserId: positionStampAccessLog.viewerUserId,
			workPeriodIds: positionStampAccessLog.workPeriodIds,
			exportId: positionStampAccessLog.exportId,
		})
		.from(positionStampAccessLog)
		.where(
			and(
				eq(positionStampAccessLog.organizationId, organizationId),
				exists(
					database
						.select({ one: positionStampAccessLogSubject.accessLogId })
						.from(positionStampAccessLogSubject)
						.where(
							and(
								eq(positionStampAccessLogSubject.accessLogId, positionStampAccessLog.id),
								eq(positionStampAccessLogSubject.organizationId, organizationId),
								eq(positionStampAccessLogSubject.employeeId, employeeId),
							),
						),
				),
			),
		)
		.orderBy(asc(positionStampAccessLog.accessedAt), asc(positionStampAccessLog.id));
	if (entries.length === 0) return [];

	const periodIds = [...new Set(entries.flatMap((entry) => entry.workPeriodIds))];
	const ownPeriods =
		periodIds.length === 0
			? []
			: await database
					.select({
						id: workPeriod.id,
						startTime: workPeriod.startTime,
						utcOffsetMinutes: timeEntry.utcOffsetMinutes,
					})
					.from(workPeriod)
					.innerJoin(
						timeEntry,
						and(
							eq(timeEntry.id, workPeriod.clockInId),
							eq(timeEntry.organizationId, organizationId),
						),
					)
					.where(
						and(
							eq(workPeriod.organizationId, organizationId),
							eq(workPeriod.employeeId, employeeId),
							inArray(workPeriod.id, periodIds),
						),
					);
	const ownPeriodById = new Map(ownPeriods.map((period) => [period.id, period]));
	const viewerNames = await loadUserNames(
		database,
		entries.map((entry) => entry.viewerUserId),
	);

	return entries.flatMap((entry): PersonalDataRow[] => {
		const base = {
			accessed_at: instantText(entry.accessedAt),
			kind: entry.kind,
			viewer: nameOf(viewerNames, entry.viewerUserId),
		};
		const periods = entry.workPeriodIds.flatMap((id) => ownPeriodById.get(id) ?? []);
		if (periods.length === 0) {
			// An export, or work periods that no longer exist.
			return [
				{
					...base,
					work_period_id: null,
					work_period_started_at: null,
					work_period_utc_offset_minutes: null,
					export_id: entry.exportId,
				},
			];
		}
		return periods.map((period) => ({
			...base,
			work_period_id: period.id,
			work_period_started_at: instantText(period.startTime),
			work_period_utc_offset_minutes: period.utcOffsetMinutes,
			export_id: entry.exportId,
		}));
	});
}

/** Logs the requesting admin as shown the employee's stamps (#831 D4). */
async function logAdminExportAccess(
	database: Pick<PositionCaptureClient, "insert">,
	scope: PersonalDataExportScope,
): Promise<void> {
	if (scope.kind !== "admin") return;
	if (!scope.exportId) {
		throw new Error("An admin export holding position stamps must name its export.");
	}
	// The requester's account is gone: nobody is left to name as the viewer.
	if (!scope.requestedByUserId || scope.requestedByUserId === scope.userId) return;
	await recordPositionStampAccess(database, {
		organizationId: scope.organizationId,
		viewerUserId: scope.requestedByUserId,
		kind: "data_export",
		exportId: scope.exportId,
		subjectEmployeeIds: [scope.employeeId],
		accessedAt: systemClock.nowInstant(),
	});
}

import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import {
	auditLog,
	employee,
	positionCaptureAssignment,
	positionCaptureSetting,
	positionConsent,
	positionNotice,
	positionNoticeDecline,
	positionStamp,
	team,
} from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { dateFromInstant, type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import type { WorkTransactionClient } from "../work-transaction";
import {
	POSITION_NOTICE_TEMPLATE_REVISION,
	POSITION_RETENTION_DEFAULT_DAYS,
	type PositionCaptureSettings,
	type PositionCaptureSettingsInput,
	requiresNewNoticeVersion,
	validatePositionCaptureSettings,
} from "./policy";
import { bringPositionStampPurgeDatesForward } from "./purge";

/**
 * Position capture writes and reads (#825). Every function takes the caller's
 * client: a transaction for writes, so each write and its audit entry commit
 * together. Every query is filtered by `organizationId`.
 *
 * Configuration writes (settings and assignments) lock the organization's
 * settings row `FOR UPDATE`; the resolver can read it `FOR SHARE`, so a clock
 * command's capture check never interleaves with a configuration change.
 */
export type PositionCaptureClient = Pick<
	WorkTransactionClient,
	"select" | "insert" | "update" | "delete"
>;

export type PositionNoticeVersion = {
	id: string;
	version: number;
	purposeStatement: string;
	retentionDays: number;
	templateRevision: number;
	createdAt: Instant;
};

export type PositionCaptureAssignmentTarget =
	| { type: "organization" }
	| { type: "team"; teamId: string }
	| { type: "employee"; employeeId: string };

export const DEFAULT_POSITION_CAPTURE_SETTINGS: PositionCaptureSettings = {
	enabled: false,
	purposeStatement: null,
	retentionDays: POSITION_RETENTION_DEFAULT_DAYS,
};

const SETTINGS_REFUSAL_MESSAGES = {
	purpose_required: "A purpose statement is required before position capture can be switched on.",
	purpose_too_long: "The purpose statement is too long.",
	retention_out_of_range: "Retention must be a whole number of days between 7 and 365.",
} as const;

export const NOTICE_CHANGED_MESSAGE =
	"The position notice has changed. Review the current notice before deciding.";

export async function readPositionCaptureSettings(
	db: PositionCaptureClient,
	organizationId: string,
): Promise<PositionCaptureSettings> {
	const [row] = await db
		.select({
			enabled: positionCaptureSetting.enabled,
			purposeStatement: positionCaptureSetting.purposeStatement,
			retentionDays: positionCaptureSetting.retentionDays,
		})
		.from(positionCaptureSetting)
		.where(eq(positionCaptureSetting.organizationId, organizationId))
		.limit(1);
	return row ?? DEFAULT_POSITION_CAPTURE_SETTINGS;
}

/** The current notice is the organization's highest version. */
export async function readCurrentPositionNotice(
	db: PositionCaptureClient,
	organizationId: string,
): Promise<PositionNoticeVersion | null> {
	const [row] = await noticeQuery(db, organizationId).limit(1);
	return row ? toNotice(row) : null;
}

export async function listPositionNotices(
	db: PositionCaptureClient,
	organizationId: string,
): Promise<PositionNoticeVersion[]> {
	return (await noticeQuery(db, organizationId)).map(toNotice);
}

function noticeQuery(db: PositionCaptureClient, organizationId: string) {
	return db
		.select({
			id: positionNotice.id,
			version: positionNotice.version,
			purposeStatement: positionNotice.purposeStatement,
			retentionDays: positionNotice.retentionDays,
			templateRevision: positionNotice.templateRevision,
			createdAt: positionNotice.createdAt,
		})
		.from(positionNotice)
		.where(eq(positionNotice.organizationId, organizationId))
		.orderBy(desc(positionNotice.version))
		.$dynamic();
}

function toNotice(row: {
	id: string;
	version: number;
	purposeStatement: string;
	retentionDays: number;
	templateRevision: number;
	createdAt: Date;
}): PositionNoticeVersion {
	return { ...row, createdAt: instantFromDate(row.createdAt) };
}

/**
 * Saves the organization's settings. Editing the purpose statement or
 * lengthening retention publishes a new notice version, which lapses every
 * existing consent; shortening retention does not, but brings the purge dates
 * of stamps already held forward in the same transaction (#829).
 */
export async function savePositionCaptureSettings(
	tx: PositionCaptureClient,
	input: {
		organizationId: string;
		actorUserId: string;
		settings: PositionCaptureSettingsInput;
	},
): Promise<{ settings: PositionCaptureSettings; publishedNotice: PositionNoticeVersion | null }> {
	const validated = validatePositionCaptureSettings(input.settings);
	if (!validated.ok) {
		throw new ValidationError({
			message: SETTINGS_REFUSAL_MESSAGES[validated.reason],
			field: validated.reason === "retention_out_of_range" ? "retentionDays" : "purposeStatement",
		});
	}
	const next = validated.settings;
	const row = await lockSettingsRow(tx, input.organizationId);
	const current = await readCurrentPositionNotice(tx, input.organizationId);
	const previous: PositionCaptureSettings = {
		enabled: row.enabled,
		purposeStatement: row.purposeStatement,
		retentionDays: row.retentionDays,
	};

	await tx
		.update(positionCaptureSetting)
		.set({ ...next, updatedBy: input.actorUserId })
		.where(eq(positionCaptureSetting.organizationId, input.organizationId));

	// Shortening applies to stamps already held (#829); lengthening never extends them.
	const { movedCount: shortenedStampCount } =
		next.retentionDays < previous.retentionDays
			? await bringPositionStampPurgeDatesForward(tx, {
					organizationId: input.organizationId,
					retentionDays: next.retentionDays,
				})
			: { movedCount: 0 };

	let publishedNotice: PositionNoticeVersion | null = null;
	if (next.purposeStatement && requiresNewNoticeVersion(current, next)) {
		const [inserted] = await tx
			.insert(positionNotice)
			.values({
				organizationId: input.organizationId,
				version: (current?.version ?? 0) + 1,
				purposeStatement: next.purposeStatement,
				retentionDays: next.retentionDays,
				templateRevision: POSITION_NOTICE_TEMPLATE_REVISION,
				createdBy: input.actorUserId,
			})
			.returning();
		publishedNotice = toNotice(inserted);
	}

	if (!sameSettings(previous, next) || publishedNotice) {
		await tx.insert(auditLog).values({
			organizationId: input.organizationId,
			entityType: "position_capture_setting",
			entityId: row.id,
			action: AuditAction.POSITION_CAPTURE_SETTINGS_CHANGED,
			performedBy: input.actorUserId,
			changes: JSON.stringify({ from: previous, to: next }),
			metadata:
				publishedNotice || shortenedStampCount > 0
					? JSON.stringify({
							...(publishedNotice
								? {
										publishedNoticeId: publishedNotice.id,
										publishedNoticeVersion: publishedNotice.version,
									}
								: {}),
							...(shortenedStampCount > 0 ? { shortenedStampPurgeDates: shortenedStampCount } : {}),
						})
					: null,
		});
	}

	return { settings: next, publishedNotice };
}

/** Assigns capture on or off to the organization, a team or an employee; one row per target. */
export async function setPositionCaptureAssignment(
	tx: PositionCaptureClient,
	input: {
		organizationId: string;
		actorUserId: string;
		target: PositionCaptureAssignmentTarget;
		captureEnabled: boolean;
	},
): Promise<{ assignmentId: string }> {
	const { organizationId, target } = input;
	await lockSettingsRow(tx, organizationId);
	await assertTargetInOrganization(tx, organizationId, target);

	const targetFilter =
		target.type === "organization"
			? eq(positionCaptureAssignment.assignmentType, "organization")
			: target.type === "team"
				? eq(positionCaptureAssignment.teamId, target.teamId)
				: eq(positionCaptureAssignment.employeeId, target.employeeId);
	const [existing] = await tx
		.select({
			id: positionCaptureAssignment.id,
			captureEnabled: positionCaptureAssignment.captureEnabled,
		})
		.from(positionCaptureAssignment)
		.where(and(eq(positionCaptureAssignment.organizationId, organizationId), targetFilter))
		.limit(1);

	let assignmentId: string;
	if (existing) {
		if (existing.captureEnabled === input.captureEnabled) return { assignmentId: existing.id };
		await tx
			.update(positionCaptureAssignment)
			.set({ captureEnabled: input.captureEnabled })
			.where(
				and(
					eq(positionCaptureAssignment.organizationId, organizationId),
					eq(positionCaptureAssignment.id, existing.id),
				),
			);
		assignmentId = existing.id;
	} else {
		const [inserted] = await tx
			.insert(positionCaptureAssignment)
			.values({
				organizationId,
				assignmentType: target.type,
				teamId: target.type === "team" ? target.teamId : null,
				employeeId: target.type === "employee" ? target.employeeId : null,
				priority: target.type === "organization" ? 0 : target.type === "team" ? 1 : 2,
				captureEnabled: input.captureEnabled,
				createdBy: input.actorUserId,
			})
			.returning({ id: positionCaptureAssignment.id });
		assignmentId = inserted.id;
	}

	await tx.insert(auditLog).values({
		organizationId,
		entityType: "position_capture_assignment",
		entityId: assignmentId,
		action: AuditAction.POSITION_CAPTURE_ASSIGNMENT_SET,
		performedBy: input.actorUserId,
		employeeId: target.type === "employee" ? target.employeeId : null,
		changes: JSON.stringify({
			target,
			from: existing ? { captureEnabled: existing.captureEnabled } : null,
			to: { captureEnabled: input.captureEnabled },
		}),
	});

	return { assignmentId };
}

export async function removePositionCaptureAssignment(
	tx: PositionCaptureClient,
	input: { organizationId: string; actorUserId: string; assignmentId: string },
): Promise<void> {
	await lockSettingsRow(tx, input.organizationId);
	const [removed] = await tx
		.delete(positionCaptureAssignment)
		.where(
			and(
				eq(positionCaptureAssignment.organizationId, input.organizationId),
				eq(positionCaptureAssignment.id, input.assignmentId),
			),
		)
		.returning();
	if (!removed) {
		throw new NotFoundError({
			message: "Position capture assignment not found",
			entityType: "position_capture_assignment",
			entityId: input.assignmentId,
		});
	}
	await tx.insert(auditLog).values({
		organizationId: input.organizationId,
		entityType: "position_capture_assignment",
		entityId: removed.id,
		action: AuditAction.POSITION_CAPTURE_ASSIGNMENT_REMOVED,
		performedBy: input.actorUserId,
		employeeId: removed.employeeId,
		changes: JSON.stringify({
			from: {
				assignmentType: removed.assignmentType,
				teamId: removed.teamId,
				employeeId: removed.employeeId,
				captureEnabled: removed.captureEnabled,
			},
			to: null,
		}),
	});
}

/**
 * Records the employee's position consent to `noticeId`, which must be the
 * current notice version. Agreeing again while consent is active changes nothing.
 */
export async function agreeToPositionNotice(
	tx: PositionCaptureClient,
	input: { organizationId: string; employeeId: string; noticeId: string; now: Instant },
): Promise<{ consentId: string; grantedAt: Instant }> {
	await assertCurrentNotice(tx, input.organizationId, input.noticeId);
	const [existing] = await tx
		.select({ id: positionConsent.id, grantedAt: positionConsent.grantedAt })
		.from(positionConsent)
		.where(
			and(
				eq(positionConsent.organizationId, input.organizationId),
				eq(positionConsent.employeeId, input.employeeId),
				eq(positionConsent.noticeId, input.noticeId),
				isNull(positionConsent.withdrawnAt),
			),
		)
		.limit(1);
	if (existing) {
		return { consentId: existing.id, grantedAt: instantFromDate(existing.grantedAt) };
	}
	const [inserted] = await tx
		.insert(positionConsent)
		.values({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			noticeId: input.noticeId,
			grantedAt: dateFromInstant(input.now),
		})
		.returning({ id: positionConsent.id });
	return { consentId: inserted.id, grantedAt: input.now };
}

/** Records "Not now" for the current notice version; the dialog stays quiet until a new one. */
export async function declinePositionNotice(
	tx: PositionCaptureClient,
	input: { organizationId: string; employeeId: string; noticeId: string; now: Instant },
): Promise<void> {
	await assertCurrentNotice(tx, input.organizationId, input.noticeId);
	await tx
		.insert(positionNoticeDecline)
		.values({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			noticeId: input.noticeId,
			declinedAt: dateFromInstant(input.now),
		})
		.onConflictDoNothing();
}

/**
 * Withdraws every unwithdrawn consent of the employee, active or lapsed, and
 * deletes all of the employee's position stamps in the same transaction (#826).
 * Withdrawal updates the consent rows the clocking capture check reads
 * `FOR SHARE`, so a concurrent clock command either commits its stamp first (and
 * the deletion, a later statement, removes it) or sees the withdrawal.
 */
export async function withdrawPositionConsent(
	tx: PositionCaptureClient,
	input: { organizationId: string; employeeId: string; now: Instant },
): Promise<{ withdrawnConsentIds: string[]; deletedStampCount: number }> {
	const rows = await tx
		.update(positionConsent)
		.set({ withdrawnAt: dateFromInstant(input.now) })
		.where(
			and(
				eq(positionConsent.organizationId, input.organizationId),
				eq(positionConsent.employeeId, input.employeeId),
				isNull(positionConsent.withdrawnAt),
			),
		)
		.returning({ id: positionConsent.id });
	const deleted = await tx
		.delete(positionStamp)
		.where(
			and(
				eq(positionStamp.organizationId, input.organizationId),
				eq(positionStamp.employeeId, input.employeeId),
			),
		)
		.returning({ id: positionStamp.id });
	return { withdrawnConsentIds: rows.map((row) => row.id), deletedStampCount: deleted.length };
}

async function lockSettingsRow(tx: PositionCaptureClient, organizationId: string) {
	await tx.insert(positionCaptureSetting).values({ organizationId }).onConflictDoNothing();
	const [row] = await tx
		.select()
		.from(positionCaptureSetting)
		.where(eq(positionCaptureSetting.organizationId, organizationId))
		.for("update");
	return row;
}

async function assertCurrentNotice(
	tx: PositionCaptureClient,
	organizationId: string,
	noticeId: string,
): Promise<void> {
	// Shares the settings lock so a notice published concurrently waits for this decision.
	await tx
		.select({ id: positionCaptureSetting.id })
		.from(positionCaptureSetting)
		.where(eq(positionCaptureSetting.organizationId, organizationId))
		.for("share");
	const current = await readCurrentPositionNotice(tx, organizationId);
	if (!current || current.id !== noticeId) {
		throw new ValidationError({ message: NOTICE_CHANGED_MESSAGE, field: "noticeId" });
	}
}

async function assertTargetInOrganization(
	tx: PositionCaptureClient,
	organizationId: string,
	target: PositionCaptureAssignmentTarget,
): Promise<void> {
	if (target.type === "organization") return;
	const rows =
		target.type === "team"
			? await tx
					.select({ id: team.id })
					.from(team)
					.where(and(eq(team.organizationId, organizationId), eq(team.id, target.teamId)))
					.limit(1)
			: await tx
					.select({ id: employee.id })
					.from(employee)
					.where(
						and(eq(employee.organizationId, organizationId), eq(employee.id, target.employeeId)),
					)
					.limit(1);
	if (rows.length === 0) {
		throw new NotFoundError({
			message: target.type === "team" ? "Team not found" : "Employee not found",
			entityType: target.type,
			entityId: target.type === "team" ? target.teamId : target.employeeId,
		});
	}
}

function sameSettings(left: PositionCaptureSettings, right: PositionCaptureSettings): boolean {
	return (
		left.enabled === right.enabled &&
		left.purposeStatement === right.purposeStatement &&
		left.retentionDays === right.retentionDays
	);
}

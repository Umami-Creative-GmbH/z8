/**
 * Personal data exports (#811): requests, the worker's claim and completion,
 * listing, download authorization, expiry and stored-file cleanup.
 *
 * Every query is scoped to the export's organization. Limits live in SQL on
 * `personal_data_export`, never in Redis:
 * - one export in progress per employee, of either kind (partial unique index);
 * - one employee export per user and organization every 24 hours (failed
 *   builds don't count, so a failure never locks the employee out).
 * Every request and download writes an audit entry: who, whose data, which kind.
 */

import { and, asc, desc, eq, gt, inArray, lte, ne, or, sql } from "drizzle-orm";
import type { db } from "@/db";
import {
	employee,
	type PersonalDataExportKind,
	personalDataExport,
	personalDataExportFileCleanup,
} from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { withAuditTrail } from "@/lib/audit-trail";
import { dateFromInstant, type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import { resolveEmployeeOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { isUuid } from "@/lib/validations/uuid";

type Database = typeof db;

/** Rows and files are deleted this long after completion (or after the request, when none). */
export const PERSONAL_DATA_EXPORT_LIFETIME_HOURS = 7 * 24;
/** An employee export can be started once per this many hours, per user and organization. */
export const EMPLOYEE_EXPORT_INTERVAL_HOURS = 24;
/** A build still pending or processing after this long is given up. */
export const PERSONAL_DATA_EXPORT_STALE_AFTER_HOURS = 6;

const IN_PROGRESS_INDEX = "personalDataExport_one_in_progress_idx";

export interface PersonalDataExportRequestContext {
	ipAddress?: string | null;
	userAgent?: string | null;
}

function lifetimeEnd(from: Instant): Date {
	return dateFromInstant(from.add({ hours: PERSONAL_DATA_EXPORT_LIFETIME_HOURS }));
}

function isInProgressConflict(error: unknown): boolean {
	let candidate: unknown = error;
	for (let depth = 0; depth < 4 && candidate && typeof candidate === "object"; depth += 1) {
		const current = candidate as { code?: unknown; constraint?: unknown; cause?: unknown };
		if (current.code === "23505" && current.constraint === IN_PROGRESS_INDEX) return true;
		candidate = current.cause;
	}
	return false;
}

// ============================================
// MY DATA ACCESS
// ============================================

export type MyDataAccess =
	| { status: "available"; employeeId: string }
	/** A member of the organization without an employee record: ask the admins. */
	| { status: "no_employee_record" }
	/** Past the departure cutoff, deactivated, or not a member: no My data page. */
	| { status: "unavailable" };

/** Whether the signed-in user can request their own employee export in this organization. */
export async function resolveMyDataAccess(
	client: Database,
	input: { userId: string; organizationId: string; now?: Instant },
): Promise<MyDataAccess> {
	const access = await resolveEmployeeOrganizationAccess(client, input);
	if (!access.allowed) return { status: "unavailable" };
	if (!access.employeeId) return { status: "no_employee_record" };
	return { status: "available", employeeId: access.employeeId };
}

// ============================================
// REQUEST
// ============================================

export type RequestPersonalDataExportResult =
	| { ok: true; exportId: string }
	| {
			ok: false;
			/** `own_record`: an admin export of the requester's own employee record. */
			reason: "employee_not_found" | "own_record" | "in_progress" | "daily_limit";
	  };

/**
 * Records a new export as pending, with its audit entry, in one transaction.
 * The caller enqueues the build after the commit. An admin export of the
 * requester's own employee record is refused: admins export their own data
 * from My data, like every employee.
 */
export async function requestPersonalDataExport(
	client: Database,
	input: {
		organizationId: string;
		employeeId: string;
		kind: PersonalDataExportKind;
		requestedByUserId: string;
		now: Instant;
		request?: PersonalDataExportRequestContext;
	},
): Promise<RequestPersonalDataExportResult> {
	if (!isUuid(input.employeeId)) return { ok: false, reason: "employee_not_found" };
	const [subject] = await client
		.select({ id: employee.id, userId: employee.userId })
		.from(employee)
		.where(
			and(eq(employee.id, input.employeeId), eq(employee.organizationId, input.organizationId)),
		)
		.limit(1);
	if (!subject) return { ok: false, reason: "employee_not_found" };
	if (input.kind === "admin" && subject.userId === input.requestedByUserId) {
		return { ok: false, reason: "own_record" };
	}

	if (input.kind === "employee") {
		const since = dateFromInstant(input.now.subtract({ hours: EMPLOYEE_EXPORT_INTERVAL_HOURS }));
		const [recent] = await client
			.select({ id: personalDataExport.id })
			.from(personalDataExport)
			.where(
				and(
					eq(personalDataExport.organizationId, input.organizationId),
					eq(personalDataExport.kind, "employee"),
					eq(personalDataExport.requestedByUserId, input.requestedByUserId),
					gt(personalDataExport.createdAt, since),
					ne(personalDataExport.status, "failed"),
				),
			)
			.limit(1);
		if (recent) {
			// One in progress is the clearer refusal while the earlier export still builds.
			const inProgress = await hasExportInProgress(client, input);
			return { ok: false, reason: inProgress ? "in_progress" : "daily_limit" };
		}
	}
	if (await hasExportInProgress(client, input)) return { ok: false, reason: "in_progress" };

	try {
		const exportId = await withAuditTrail((audit) =>
			client.transaction(async (tx) => {
				const [created] = await tx
					.insert(personalDataExport)
					.values({
						organizationId: input.organizationId,
						employeeId: input.employeeId,
						kind: input.kind,
						requestedByUserId: input.requestedByUserId,
						status: "pending",
						createdAt: dateFromInstant(input.now),
						expiresAt: lifetimeEnd(input.now),
					})
					.returning({ id: personalDataExport.id });
				if (!created) throw new Error("Personal data export insert returned no row");
				await audit.record(tx, {
					organizationId: input.organizationId,
					action: AuditAction.PERSONAL_DATA_EXPORT_REQUESTED,
					actorUserId: input.requestedByUserId,
					targetType: "personal_data_export",
					targetId: created.id,
					employeeId: input.employeeId,
					metadata: {
						kind: input.kind,
						employeeId: input.employeeId,
						requestedByUserId: input.requestedByUserId,
					},
					ipAddress: input.request?.ipAddress ?? null,
					userAgent: input.request?.userAgent ?? null,
				});
				return created.id;
			}),
		);
		return { ok: true, exportId };
	} catch (error) {
		// A concurrent request for the same employee won the in-progress slot.
		if (isInProgressConflict(error)) return { ok: false, reason: "in_progress" };
		throw error;
	}
}

async function hasExportInProgress(
	client: Database,
	input: { organizationId: string; employeeId: string },
): Promise<boolean> {
	const [row] = await client
		.select({ id: personalDataExport.id })
		.from(personalDataExport)
		.where(
			and(
				eq(personalDataExport.organizationId, input.organizationId),
				eq(personalDataExport.employeeId, input.employeeId),
				inArray(personalDataExport.status, ["pending", "processing"]),
			),
		)
		.limit(1);
	return Boolean(row);
}

/** Marks a pending export failed, e.g. when its build could not be queued. */
export async function failPendingPersonalDataExport(
	client: Database,
	input: { organizationId: string; exportId: string; errorCode: string; now: Instant },
): Promise<void> {
	await client
		.update(personalDataExport)
		.set({ status: "failed", errorCode: input.errorCode, expiresAt: lifetimeEnd(input.now) })
		.where(
			and(
				eq(personalDataExport.id, input.exportId),
				eq(personalDataExport.organizationId, input.organizationId),
				eq(personalDataExport.status, "pending"),
			),
		);
}

// ============================================
// BUILD (worker)
// ============================================

export interface ClaimedPersonalDataExport {
	id: string;
	organizationId: string;
	employeeId: string;
	kind: PersonalDataExportKind;
	requestedByUserId: string | null;
}

/** Moves a pending export to processing; null when it is not pending any more. */
export async function claimPersonalDataExport(
	client: Database,
	input: { organizationId: string; exportId: string; now: Instant },
): Promise<ClaimedPersonalDataExport | null> {
	if (!isUuid(input.exportId)) return null;
	const [claimed] = await client
		.update(personalDataExport)
		.set({ status: "processing", startedAt: dateFromInstant(input.now) })
		.where(
			and(
				eq(personalDataExport.id, input.exportId),
				eq(personalDataExport.organizationId, input.organizationId),
				eq(personalDataExport.status, "pending"),
			),
		)
		.returning({
			id: personalDataExport.id,
			organizationId: personalDataExport.organizationId,
			employeeId: personalDataExport.employeeId,
			kind: personalDataExport.kind,
			requestedByUserId: personalDataExport.requestedByUserId,
		});
	return claimed ?? null;
}

export interface StoredPersonalDataExportFile {
	key: string;
	bucket: string;
	versionId: string | null;
	sizeBytes: number;
	checksumSha256: string;
}

/** Completes a processing export; false when it was failed or deleted meanwhile. */
export async function completePersonalDataExport(
	client: Database,
	input: {
		organizationId: string;
		exportId: string;
		file: StoredPersonalDataExportFile;
		now: Instant;
	},
): Promise<boolean> {
	const completed = await client
		.update(personalDataExport)
		.set({
			status: "completed",
			storageKey: input.file.key,
			storageBucket: input.file.bucket,
			storageVersionId: input.file.versionId,
			sizeBytes: input.file.sizeBytes,
			checksumSha256: input.file.checksumSha256,
			completedAt: dateFromInstant(input.now),
			expiresAt: lifetimeEnd(input.now),
		})
		.where(
			and(
				eq(personalDataExport.id, input.exportId),
				eq(personalDataExport.organizationId, input.organizationId),
				eq(personalDataExport.status, "processing"),
			),
		)
		.returning({ id: personalDataExport.id });
	return completed.length > 0;
}

/** Fails a processing export with a machine-readable code; false when it is not processing. */
export async function failPersonalDataExport(
	client: Database,
	input: { organizationId: string; exportId: string; errorCode: string; now: Instant },
): Promise<boolean> {
	const failed = await client
		.update(personalDataExport)
		.set({ status: "failed", errorCode: input.errorCode, expiresAt: lifetimeEnd(input.now) })
		.where(
			and(
				eq(personalDataExport.id, input.exportId),
				eq(personalDataExport.organizationId, input.organizationId),
				eq(personalDataExport.status, "processing"),
			),
		)
		.returning({ id: personalDataExport.id });
	return failed.length > 0;
}

// ============================================
// LIST AND DOWNLOAD
// ============================================

export interface PersonalDataExportSummary {
	id: string;
	kind: PersonalDataExportKind;
	status: "pending" | "processing" | "completed" | "failed";
	/** UTC ISO instants. */
	createdAt: string;
	completedAt: string | null;
	expiresAt: string;
	sizeBytes: number | null;
}

/** Whether `employeeId` is the employee record of `userId` in the organization. */
async function isOwnEmployeeRecord(
	client: Database,
	input: { organizationId: string; employeeId: string; userId: string },
): Promise<boolean> {
	const [subject] = await client
		.select({ userId: employee.userId })
		.from(employee)
		.where(
			and(eq(employee.id, input.employeeId), eq(employee.organizationId, input.organizationId)),
		)
		.limit(1);
	return subject?.userId === input.userId;
}

export type ListAdminPersonalDataExportsResult =
	| { ok: true; exports: PersonalDataExportSummary[] }
	/** `own_record`: admins never see the admin exports of their own employee record. */
	| { ok: false; reason: "employee_not_found" | "own_record" };

/**
 * One employee's live admin exports, newest first, for an org admin. An admin
 * export holds withheld data, so the admin it is about never sees it, even
 * when another admin made it.
 */
export async function listAdminPersonalDataExports(
	client: Database,
	input: { organizationId: string; employeeId: string; actorUserId: string; now: Instant },
): Promise<ListAdminPersonalDataExportsResult> {
	if (!isUuid(input.employeeId)) return { ok: false, reason: "employee_not_found" };
	if (
		await isOwnEmployeeRecord(client, {
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			userId: input.actorUserId,
		})
	) {
		return { ok: false, reason: "own_record" };
	}
	const exports = await listPersonalDataExports(client, { ...input, kind: "admin" });
	return { ok: true, exports };
}

/** One employee's live exports of one kind, newest first. */
export async function listPersonalDataExports(
	client: Database,
	input: {
		organizationId: string;
		employeeId: string;
		kind: PersonalDataExportKind;
		now: Instant;
	},
): Promise<PersonalDataExportSummary[]> {
	const rows = await client
		.select({
			id: personalDataExport.id,
			kind: personalDataExport.kind,
			status: personalDataExport.status,
			createdAt: personalDataExport.createdAt,
			completedAt: personalDataExport.completedAt,
			expiresAt: personalDataExport.expiresAt,
			sizeBytes: personalDataExport.sizeBytes,
		})
		.from(personalDataExport)
		.where(
			and(
				eq(personalDataExport.organizationId, input.organizationId),
				eq(personalDataExport.employeeId, input.employeeId),
				eq(personalDataExport.kind, input.kind),
				gt(personalDataExport.expiresAt, dateFromInstant(input.now)),
			),
		)
		.orderBy(desc(personalDataExport.createdAt));
	return rows.map((row) => ({
		id: row.id,
		kind: row.kind,
		status: row.status,
		createdAt: instantFromDate(row.createdAt).toString(),
		completedAt: row.completedAt ? instantFromDate(row.completedAt).toString() : null,
		expiresAt: instantFromDate(row.expiresAt).toString(),
		sizeBytes: row.sizeBytes,
	}));
}

export type PersonalDataExportDownload =
	| {
			ok: true;
			object: { key: string; bucket: string | null; versionId: string | null };
			fileName: string;
	  }
	| { ok: false; reason: "not_found" | "not_ready" };

/**
 * Authorizes one download and records it in the audit log before the file
 * leaves. An employee export is downloadable only by the user who requested
 * it, an admin export only by an org admin. Anyone else sees "not found".
 */
export async function authorizePersonalDataExportDownload(
	client: Database,
	input: {
		organizationId: string;
		exportId: string;
		actor: { userId: string; isOrganizationAdmin: boolean };
		now: Instant;
		request?: PersonalDataExportRequestContext;
	},
): Promise<PersonalDataExportDownload> {
	if (!isUuid(input.exportId)) return { ok: false, reason: "not_found" };
	const [row] = await client
		.select()
		.from(personalDataExport)
		.where(
			and(
				eq(personalDataExport.id, input.exportId),
				eq(personalDataExport.organizationId, input.organizationId),
				gt(personalDataExport.expiresAt, dateFromInstant(input.now)),
			),
		)
		.limit(1);
	if (!row) return { ok: false, reason: "not_found" };
	const allowed =
		row.kind === "employee"
			? row.requestedByUserId === input.actor.userId
			: input.actor.isOrganizationAdmin &&
				!(await isOwnEmployeeRecord(client, {
					organizationId: input.organizationId,
					employeeId: row.employeeId,
					userId: input.actor.userId,
				}));
	if (!allowed) return { ok: false, reason: "not_found" };
	if (row.status !== "completed" || !row.storageKey || !row.completedAt) {
		return { ok: false, reason: "not_ready" };
	}

	await withAuditTrail((audit) =>
		client.transaction((tx) =>
			audit.record(tx, {
				organizationId: input.organizationId,
				action: AuditAction.PERSONAL_DATA_EXPORT_DOWNLOADED,
				actorUserId: input.actor.userId,
				targetType: "personal_data_export",
				targetId: row.id,
				employeeId: row.employeeId,
				metadata: {
					kind: row.kind,
					employeeId: row.employeeId,
					requestedByUserId: row.requestedByUserId,
				},
				ipAddress: input.request?.ipAddress ?? null,
				userAgent: input.request?.userAgent ?? null,
			}),
		),
	);
	const day = instantFromDate(row.completedAt).toZonedDateTimeISO("UTC").toPlainDate().toString();
	return {
		ok: true,
		object: { key: row.storageKey, bucket: row.storageBucket, versionId: row.storageVersionId },
		fileName: `personal-data-${day}.zip`,
	};
}

// ============================================
// EXPIRY AND CLEANUP (sweep)
// ============================================

/**
 * Deletes every export past its expiry, in every organization. The delete
 * trigger hands their stored files to the cleanup ledger.
 */
export async function expirePersonalDataExports(
	client: Database,
	input: { now: Instant },
): Promise<number> {
	const deleted = await client
		.delete(personalDataExport)
		.where(lte(personalDataExport.expiresAt, dateFromInstant(input.now)))
		.returning({ id: personalDataExport.id });
	return deleted.length;
}

/** Gives up builds that stayed pending or processing too long (a lost job or a crashed worker). */
export async function failStalePersonalDataExports(
	client: Database,
	input: { now: Instant },
): Promise<number> {
	const staleBefore = dateFromInstant(
		input.now.subtract({ hours: PERSONAL_DATA_EXPORT_STALE_AFTER_HOURS }),
	);
	const failed = await client
		.update(personalDataExport)
		.set({ status: "failed", errorCode: "timed_out", expiresAt: lifetimeEnd(input.now) })
		.where(
			and(
				inArray(personalDataExport.status, ["pending", "processing"]),
				lte(personalDataExport.createdAt, staleBefore),
			),
		)
		.returning({ id: personalDataExport.id });
	return failed.length;
}

export type DeletePersonalDataExportObject = (input: {
	organizationId: string;
	key: string;
	bucket: string | null;
	versionId: string | null;
}) => Promise<void>;

const CLEANUP_RETRY_BASE_MINUTES = 15;
const CLEANUP_RETRY_MAX_MINUTES = 24 * 60;

/** Deletes the stored files of deleted exports; failures back off and stay recorded. */
export async function drainPersonalDataExportFileCleanup(
	client: Database,
	input: { now: Instant; deleteObject: DeletePersonalDataExportObject; limit?: number },
): Promise<{ deleted: number; failed: number }> {
	const due = await client
		.select()
		.from(personalDataExportFileCleanup)
		.where(
			// Never-tried files are due at once, whatever the database clock wrote.
			or(
				eq(personalDataExportFileCleanup.attempts, 0),
				lte(personalDataExportFileCleanup.nextAttemptAt, dateFromInstant(input.now)),
			),
		)
		.orderBy(asc(personalDataExportFileCleanup.createdAt))
		.limit(input.limit ?? 100);
	const result = { deleted: 0, failed: 0 };
	for (const row of due) {
		try {
			await input.deleteObject({
				organizationId: row.organizationId,
				key: row.storageKey,
				bucket: row.storageBucket,
				versionId: row.storageVersionId,
			});
			await client
				.delete(personalDataExportFileCleanup)
				.where(eq(personalDataExportFileCleanup.id, row.id));
			result.deleted += 1;
		} catch {
			const attempts = row.attempts + 1;
			const delayMinutes = Math.min(
				CLEANUP_RETRY_BASE_MINUTES * 2 ** (attempts - 1),
				CLEANUP_RETRY_MAX_MINUTES,
			);
			await client
				.update(personalDataExportFileCleanup)
				.set({
					attempts,
					nextAttemptAt: dateFromInstant(input.now.add({ minutes: delayMinutes })),
				})
				.where(eq(personalDataExportFileCleanup.id, row.id));
			result.failed += 1;
		}
	}
	return result;
}

/** Cleanup work still recorded, including backed-off failures. */
export async function countPersonalDataExportFileCleanup(client: Database): Promise<number> {
	const [row] = await client
		.select({ count: sql<number>`count(*)::int` })
		.from(personalDataExportFileCleanup);
	return row?.count ?? 0;
}

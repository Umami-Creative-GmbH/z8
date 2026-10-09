import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, isNull, lt, notExists, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { employeeDocument, payslipBatch, payslipBatchFile, personnelFileUpload } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { managesCategory, type PersonnelFileAccess } from "./access";
import { listManagedEmployees, type ManagedEmployee } from "./access-store";
import { writeDocumentAudit, writePayslipBatchAudit } from "./audit";
import { type DocumentVisibility, isDocumentVisibility, type PayPeriod } from "./document.types";
import { DOCUMENT_TITLE_MAX_LENGTH } from "./document-rules";
import { PERSONNEL_DOCUMENT_STORAGE_PROVIDER, personnelDocumentStorageKey } from "./document-store";
import {
	PAYSLIP_BATCH_MAX_FILES,
	type PayslipBatchStatus,
	type PayslipFileFailure,
	type PayslipMatchKind,
} from "./payslip-batch.types";
import { loadOrganizationDay } from "./organization-day";
import { matchPayslipFile } from "./payslip-matching";
import {
	type CopyPersonnelFileObject,
	markPersonnelFileUploadFailed,
	type StoredPersonnelFileObject,
} from "./upload-ledger";

/**
 * Payslip batches (#868, CONTEXT.md "Payslip batch"). An officer who manages
 * payslips starts a batch for one pay period, stages PDF files that are
 * matched to employees in their scope by personnel number, fixes the matches
 * by hand and confirms. Nothing becomes an employee document before
 * confirmation: each staged object is held by a pending upload ledger row, so
 * files that are never confirmed are cleaned up like abandoned uploads.
 *
 * Confirmation works file by file: a staged file's id becomes its document's
 * id, so a retry after a partial failure skips what was created and creates
 * no duplicates. The document's object lives under the employee's key like a
 * single upload's; the staged batch object is cleaned up. Only the officer who
 * started a batch sees and changes it.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Pick<Transaction, "select">;
type BatchRow = typeof payslipBatch.$inferSelect;
type FileRow = typeof payslipBatchFile.$inferSelect;

/** Open batches untouched for this long are deleted; their staged files were cleaned up already. */
export const ABANDONED_PAYSLIP_BATCH_AFTER_MS = 48 * 60 * 60 * 1000;

export interface PayslipBatchView {
	id: string;
	payPeriod: PayPeriod;
	visibility: DocumentVisibility;
	status: PayslipBatchStatus;
	/** ISO instant. */
	createdAt: string;
	/** ISO instant of the first confirmation. */
	confirmedAt: string | null;
}

/**
 * `staged`: waiting for confirmation. `created`: an employee document now.
 * `failed`: confirmation failed and can be retried. `expired`: the staged
 * object was cleaned up before confirmation.
 */
export type PayslipBatchFileState = "staged" | "created" | "failed" | "expired";

export interface PayslipBatchFileView {
	id: string;
	fileName: string;
	sizeBytes: number;
	matchKind: PayslipMatchKind;
	matchedEmployeeIds: string[];
	assignedEmployeeId: string | null;
	/** The employee the file goes to: the hand-picked one, else a unique match. */
	employeeId: string | null;
	included: boolean;
	state: PayslipBatchFileState;
	failure: PayslipFileFailure | null;
	/** The employee already has another payslip for the batch's pay period. */
	alreadyHasPayslip: boolean;
}

export interface PayslipBatchPreview {
	batch: PayslipBatchView;
	files: PayslipBatchFileView[];
	/** The employees the officer may assign files to: everyone whose payslips they manage. */
	employees: ManagedEmployee[];
}

export interface PayslipBatchSummary extends PayslipBatchView {
	fileCount: number;
}

function toBatchView(row: BatchRow): PayslipBatchView {
	return {
		id: row.id,
		payPeriod: { year: row.payPeriodYear, month: row.payPeriodMonth },
		visibility: row.visibility,
		status: row.status,
		createdAt: row.createdAt.toISOString(),
		confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
	};
}

/** The employee a staged file goes to on confirmation, if any. Ambiguous matches never decide. */
export function effectiveEmployeeId(file: {
	assignedEmployeeId: string | null;
	matchKind: PayslipMatchKind;
	matchedEmployeeIds: readonly string[];
}): string | null {
	if (file.assignedEmployeeId) return file.assignedEmployeeId;
	return file.matchKind === "matched" ? (file.matchedEmployeeIds[0] ?? null) : null;
}

/** Only officers, owners and admins who manage payslips may start and run a batch. */
export function canRunPayslipBatches(access: PersonnelFileAccess): boolean {
	return managesCategory(access, "payslip");
}

function payPeriodOf(value: unknown): PayPeriod | null {
	if (!value || typeof value !== "object") return null;
	const { year, month } = value as Record<string, unknown>;
	if (
		typeof year !== "number" ||
		typeof month !== "number" ||
		!Number.isInteger(year) ||
		!Number.isInteger(month) ||
		year < 1900 ||
		year > 2999 ||
		month < 1 ||
		month > 12
	) {
		return null;
	}
	return { year, month };
}

/** The employees whose payslips the actor manages: the only match candidates. */
export function listPayslipCandidates(
	database: Reader,
	access: PersonnelFileAccess,
): Promise<ManagedEmployee[]> {
	return listManagedEmployees(database, access, { category: "payslip" });
}

export type CreatePayslipBatchResult =
	| { kind: "created"; batch: PayslipBatchView }
	| { kind: "forbidden" }
	| { kind: "invalid"; field: "payPeriod" | "visibility"; message: string };

export async function createPayslipBatch(
	database: Database,
	access: PersonnelFileAccess,
	input: { payPeriod: unknown; visibility: unknown },
	now: Instant = systemClock.nowInstant(),
): Promise<CreatePayslipBatchResult> {
	if (!canRunPayslipBatches(access)) return { kind: "forbidden" };
	const payPeriod = payPeriodOf(input.payPeriod);
	if (!payPeriod) {
		return { kind: "invalid", field: "payPeriod", message: "Enter a valid pay period." };
	}
	const visibility = input.visibility ?? "shared";
	if (!isDocumentVisibility(visibility)) {
		return { kind: "invalid", field: "visibility", message: "Choose who can see the payslips." };
	}
	const at = dateFromInstant(now);
	const [row] = await database
		.insert(payslipBatch)
		.values({
			organizationId: access.organizationId,
			payPeriodYear: payPeriod.year,
			payPeriodMonth: payPeriod.month,
			visibility,
			status: "open",
			createdBy: access.userId,
			createdAt: at,
			updatedAt: at,
		})
		.returning();
	if (!row) throw new Error("Failed to start the payslip batch");
	return { kind: "created", batch: toBatchView(row) };
}

function ownBatchCondition(access: PersonnelFileAccess, batchId: string) {
	return and(
		eq(payslipBatch.id, batchId),
		eq(payslipBatch.organizationId, access.organizationId),
		eq(payslipBatch.createdBy, access.userId),
	);
}

/** The actor's own batch; null for anyone else's and for actors who no longer manage payslips. */
export async function loadOwnPayslipBatch(
	database: Reader,
	access: PersonnelFileAccess,
	batchId: string,
): Promise<PayslipBatchView | null> {
	if (!canRunPayslipBatches(access)) return null;
	const [row] = await database
		.select()
		.from(payslipBatch)
		.where(ownBatchCondition(access, batchId))
		.limit(1);
	return row ? toBatchView(row) : null;
}

/** The actor's recent batches, newest first. */
export async function listOwnPayslipBatches(
	database: Reader,
	access: PersonnelFileAccess,
	limit = 20,
): Promise<PayslipBatchSummary[]> {
	if (!canRunPayslipBatches(access)) return [];
	const rows = await database
		.select({ batch: payslipBatch, fileCount: count(payslipBatchFile.id) })
		.from(payslipBatch)
		.leftJoin(
			payslipBatchFile,
			and(
				eq(payslipBatchFile.batchId, payslipBatch.id),
				eq(payslipBatchFile.organizationId, payslipBatch.organizationId),
			),
		)
		.where(
			and(
				eq(payslipBatch.organizationId, access.organizationId),
				eq(payslipBatch.createdBy, access.userId),
			),
		)
		.groupBy(payslipBatch.id)
		.orderBy(desc(payslipBatch.createdAt), desc(payslipBatch.id))
		.limit(limit);
	return rows.map((row) => ({ ...toBatchView(row.batch), fileCount: row.fileCount }));
}

/**
 * Write-once object key of a staged payslip. Confirmation copies the object
 * to the employee's document key and hands this one to cleanup.
 */
export function payslipBatchStorageKey(input: {
	organizationId: string;
	batchId: string;
	fileId: string;
	fileName: string;
}): string {
	return `personnel-files/${input.organizationId}/payslip-batches/${input.batchId}/${input.fileId}-${input.fileName}`;
}

export type ReservePayslipBatchFileResult =
	| { kind: "reserved" }
	| { kind: "not_found" }
	| { kind: "closed" }
	| { kind: "full" };

/**
 * Commits the staging ledger row of a file before its object is stored, so a
 * crash never leaks the object. Refused once the batch was confirmed or holds
 * the maximum number of files.
 */
export async function reservePayslipBatchFile(
	database: Database,
	access: PersonnelFileAccess,
	input: { batchId: string; fileId: string; storageKey: string },
	now: Instant = systemClock.nowInstant(),
): Promise<ReservePayslipBatchFileResult> {
	if (!canRunPayslipBatches(access)) return { kind: "not_found" };
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const [batch] = await tx
			.select()
			.from(payslipBatch)
			.where(ownBatchCondition(access, input.batchId))
			.for("update");
		if (!batch) return { kind: "not_found" };
		if (batch.status !== "open") return { kind: "closed" };
		// Every file of the batch counts, also those whose staged object expired,
		// plus reservations whose file is still being stored.
		const [files] = await tx
			.select({ count: count() })
			.from(payslipBatchFile)
			.where(
				and(
					eq(payslipBatchFile.organizationId, access.organizationId),
					eq(payslipBatchFile.batchId, batch.id),
				),
			);
		const [reserved] = await tx
			.select({ count: count() })
			.from(personnelFileUpload)
			.where(
				and(
					eq(personnelFileUpload.organizationId, access.organizationId),
					eq(personnelFileUpload.batchId, batch.id),
					eq(personnelFileUpload.status, "pending"),
					notExists(
						tx
							.select({ id: payslipBatchFile.id })
							.from(payslipBatchFile)
							.where(
								and(
									eq(payslipBatchFile.id, personnelFileUpload.id),
									eq(payslipBatchFile.organizationId, personnelFileUpload.organizationId),
								),
							),
					),
				),
			);
		if ((files?.count ?? 0) + (reserved?.count ?? 0) >= PAYSLIP_BATCH_MAX_FILES) {
			return { kind: "full" };
		}
		await tx.insert(personnelFileUpload).values({
			id: input.fileId,
			organizationId: access.organizationId,
			employeeId: null,
			batchId: batch.id,
			uploadedBy: access.userId,
			storageKey: input.storageKey,
			status: "pending",
			createdAt: at,
			updatedAt: at,
		});
		await tx
			.update(payslipBatch)
			.set({ updatedAt: at })
			.where(
				and(eq(payslipBatch.id, batch.id), eq(payslipBatch.organizationId, access.organizationId)),
			);
		return { kind: "reserved" };
	});
}

export type RecordPayslipBatchFileResult =
	| { kind: "recorded"; fileId: string; matchKind: PayslipMatchKind }
	| { kind: "not_pending" };

/**
 * Records a stored object as a staged file of the batch, matched by personnel
 * number against the employees whose payslips the actor manages.
 */
export async function recordPayslipBatchFile(
	database: Database,
	access: PersonnelFileAccess,
	input: {
		batchId: string;
		fileId: string;
		storageKey: string;
		originalFileName: string;
		fileName: string;
		mimeType: string;
		sizeBytes: number;
		checksumSha256: string;
		stored: StoredPersonnelFileObject;
	},
	now: Instant = systemClock.nowInstant(),
): Promise<RecordPayslipBatchFileResult> {
	const candidates = await listPayslipCandidates(database, access);
	const match = matchPayslipFile(
		input.originalFileName,
		candidates.map((employee) => ({
			employeeId: employee.id,
			personnelNumber: employee.employeeNumber,
		})),
	);
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const held = await tx
			.update(personnelFileUpload)
			.set({
				storageBucket: input.stored.bucket,
				storageVersionId: input.stored.versionId,
				updatedAt: at,
			})
			.where(
				and(
					eq(personnelFileUpload.id, input.fileId),
					eq(personnelFileUpload.organizationId, access.organizationId),
					eq(personnelFileUpload.storageKey, input.storageKey),
					eq(personnelFileUpload.status, "pending"),
				),
			)
			.returning({ id: personnelFileUpload.id });
		if (held.length !== 1) return { kind: "not_pending" };
		await tx.insert(payslipBatchFile).values({
			id: input.fileId,
			organizationId: access.organizationId,
			batchId: input.batchId,
			originalFileName: input.originalFileName,
			fileName: input.fileName,
			storageKey: input.storageKey,
			storageBucket: input.stored.bucket,
			storageVersionId: input.stored.versionId,
			mimeType: input.mimeType,
			sizeBytes: input.sizeBytes,
			checksumSha256: input.checksumSha256,
			matchKind: match.kind,
			matchedEmployeeIds:
				match.kind === "matched"
					? [match.employeeId]
					: match.kind === "ambiguous"
						? match.employeeIds
						: [],
			createdAt: at,
			updatedAt: at,
		});
		return { kind: "recorded", fileId: input.fileId, matchKind: match.kind };
	});
}

async function loadFiles(
	database: Reader,
	organizationId: string,
	batchId: string,
): Promise<Array<FileRow & { pending: boolean }>> {
	const rows = await database
		.select({ file: payslipBatchFile, pendingId: personnelFileUpload.id })
		.from(payslipBatchFile)
		.leftJoin(
			personnelFileUpload,
			and(
				eq(personnelFileUpload.id, payslipBatchFile.id),
				eq(personnelFileUpload.organizationId, payslipBatchFile.organizationId),
				eq(personnelFileUpload.status, "pending"),
			),
		)
		.where(
			and(
				eq(payslipBatchFile.organizationId, organizationId),
				eq(payslipBatchFile.batchId, batchId),
			),
		)
		.orderBy(payslipBatchFile.originalFileName, payslipBatchFile.id);
	return rows.map((row) => ({ ...row.file, pending: row.pendingId !== null }));
}

function stateOf(file: FileRow & { pending: boolean }): PayslipBatchFileState {
	if (file.documentId) return "created";
	if (!file.pending) return "expired";
	return file.failure ? "failed" : "staged";
}

/** The batch with every staged file, its match, its state and the duplicate pay period flag. */
export async function loadPayslipBatchPreview(
	database: Reader,
	access: PersonnelFileAccess,
	batchId: string,
): Promise<PayslipBatchPreview | null> {
	const batch = await loadOwnPayslipBatch(database, access, batchId);
	if (!batch) return null;
	const [files, employees] = await Promise.all([
		loadFiles(database, access.organizationId, batch.id),
		listPayslipCandidates(database, access),
	]);
	const employeeIds = [
		...new Set(files.map(effectiveEmployeeId).filter((id): id is string => id !== null)),
	];
	const existing =
		employeeIds.length === 0
			? []
			: await database
					.select({ id: employeeDocument.id, employeeId: employeeDocument.employeeId })
					.from(employeeDocument)
					.where(
						and(
							eq(employeeDocument.organizationId, access.organizationId),
							eq(employeeDocument.category, "payslip"),
							eq(employeeDocument.payPeriodYear, batch.payPeriod.year),
							eq(employeeDocument.payPeriodMonth, batch.payPeriod.month),
							inArray(employeeDocument.employeeId, employeeIds),
						),
					);
	return {
		batch,
		employees,
		files: files.map((file) => {
			const employeeId = effectiveEmployeeId(file);
			return {
				id: file.id,
				fileName: file.originalFileName,
				sizeBytes: file.sizeBytes,
				matchKind: file.matchKind,
				matchedEmployeeIds: file.matchedEmployeeIds,
				assignedEmployeeId: file.assignedEmployeeId,
				employeeId,
				included: file.included,
				state: stateOf(file),
				failure: file.documentId ? null : file.failure,
				alreadyHasPayslip:
					employeeId !== null &&
					existing.some(
						(document) => document.employeeId === employeeId && document.id !== file.id,
					),
			};
		}),
	};
}

export type UpdatePayslipBatchFileResult =
	| { kind: "updated" }
	| { kind: "not_found" }
	| { kind: "invalid"; message: string };

/** Assigns a file to an employee by hand (or clears the assignment), or drops or includes it. */
export async function updatePayslipBatchFile(
	database: Database,
	access: PersonnelFileAccess,
	input: {
		batchId: string;
		fileId: string;
		assignedEmployeeId?: string | null;
		included?: boolean;
	},
	now: Instant = systemClock.nowInstant(),
): Promise<UpdatePayslipBatchFileResult> {
	const batch = await loadOwnPayslipBatch(database, access, input.batchId);
	if (!batch) return { kind: "not_found" };
	if (input.assignedEmployeeId) {
		const candidates = await listPayslipCandidates(database, access);
		if (!candidates.some((employee) => employee.id === input.assignedEmployeeId)) {
			return { kind: "invalid", message: "Choose an employee whose payslips you manage." };
		}
	}
	const set: Partial<typeof payslipBatchFile.$inferInsert> = { updatedAt: dateFromInstant(now) };
	if (input.assignedEmployeeId !== undefined) set.assignedEmployeeId = input.assignedEmployeeId;
	if (input.included !== undefined) set.included = input.included;
	const updated = await database
		.update(payslipBatchFile)
		.set(set)
		.where(
			and(
				eq(payslipBatchFile.id, input.fileId),
				eq(payslipBatchFile.batchId, batch.id),
				eq(payslipBatchFile.organizationId, access.organizationId),
				// A file that already became a document is final.
				isNull(payslipBatchFile.documentId),
			),
		)
		.returning({ id: payslipBatchFile.id });
	return updated.length === 1 ? { kind: "updated" } : { kind: "not_found" };
}

export interface PayslipBatchFileOutcome {
	fileId: string;
	fileName: string;
	employeeId: string | null;
}

export type ConfirmPayslipBatchResult =
	| { kind: "not_found" }
	| { kind: "unresolved"; fileIds: string[] }
	| {
			kind: "confirmed";
			batch: PayslipBatchView;
			created: PayslipBatchFileOutcome[];
			failed: Array<PayslipBatchFileOutcome & { failure: PayslipFileFailure }>;
			/**
			 * Employees who got their first payslip of this batch in this run, with
			 * the number created for them. Notify these after a shared batch.
			 */
			firstDocumentsFor: Array<{ employeeId: string; documentCount: number }>;
	  };

type FileConfirmation =
	| { kind: "created"; employeeId: string }
	| { kind: "already" }
	| { kind: "skipped" }
	| { kind: "failed"; failure: PayslipFileFailure };

function fileCondition(access: PersonnelFileAccess, batchId: string, fileId: string) {
	return and(
		eq(payslipBatchFile.id, fileId),
		eq(payslipBatchFile.batchId, batchId),
		eq(payslipBatchFile.organizationId, access.organizationId),
	);
}

async function failFile(
	tx: Pick<Transaction, "update">,
	access: PersonnelFileAccess,
	input: { batchId: string; fileId: string; at: Date },
	failure: PayslipFileFailure,
): Promise<FileConfirmation> {
	await tx
		.update(payslipBatchFile)
		.set({ failure, updatedAt: input.at })
		.where(
			and(
				fileCondition(access, input.batchId, input.fileId),
				isNull(payslipBatchFile.documentId),
			),
		);
	return { kind: "failed", failure };
}

type PreparedCopy =
	| { kind: "copy"; file: FileRow; employeeId: string; targetKey: string; targetLedgerId: string }
	| FileConfirmation;

/**
 * Step 1 of a file's confirmation: checks the file and stages the ledger row
 * of its document object (the employee's key, like a single upload) before
 * the object is copied, so a crash never leaks the copy. A pending row left by
 * an interrupted earlier attempt is reused.
 */
async function prepareFileCopy(
	database: Database,
	access: PersonnelFileAccess,
	input: { batch: PayslipBatchView; fileId: string; inScope: ReadonlySet<string>; at: Date },
): Promise<PreparedCopy> {
	return database.transaction(async (tx): Promise<PreparedCopy> => {
		const [file] = await tx
			.select()
			.from(payslipBatchFile)
			.where(fileCondition(access, input.batch.id, input.fileId))
			.for("update");
		if (!file?.included) return { kind: "skipped" };
		if (file.documentId) return { kind: "already" };
		const failure = { batchId: input.batch.id, fileId: file.id, at: input.at };
		const employeeId = effectiveEmployeeId(file);
		if (!employeeId || !input.inScope.has(employeeId)) {
			return failFile(tx, access, failure, "out_of_scope");
		}
		const [staged] = await tx
			.select({ id: personnelFileUpload.id })
			.from(personnelFileUpload)
			.where(
				and(
					eq(personnelFileUpload.id, file.id),
					eq(personnelFileUpload.organizationId, access.organizationId),
					eq(personnelFileUpload.storageKey, file.storageKey),
					eq(personnelFileUpload.status, "pending"),
				),
			)
			.for("update");
		if (!staged) return failFile(tx, access, failure, "expired");

		const targetKey = personnelDocumentStorageKey({
			organizationId: access.organizationId,
			employeeId,
			documentId: file.id,
			fileName: file.fileName,
		});
		await tx
			.insert(personnelFileUpload)
			.values({
				id: randomUUID(),
				organizationId: access.organizationId,
				employeeId,
				uploadedBy: access.userId,
				storageKey: targetKey,
				status: "pending",
				createdAt: input.at,
				updatedAt: input.at,
			})
			.onConflictDoNothing();
		const [target] = await tx
			.select({ id: personnelFileUpload.id, status: personnelFileUpload.status })
			.from(personnelFileUpload)
			.where(
				and(
					eq(personnelFileUpload.organizationId, access.organizationId),
					eq(personnelFileUpload.storageKey, targetKey),
				),
			);
		// The cleanup worker still holds an earlier failed copy: retry later.
		if (target?.status !== "pending") return failFile(tx, access, failure, "error");
		return { kind: "copy", file, employeeId, targetKey, targetLedgerId: target.id };
	});
}

/**
 * Step 3 of a file's confirmation, after the object was copied: records the
 * payslip on the copy, releases the copy's ledger row and hands the staged
 * batch object to cleanup, in one transaction with the upload audit. The
 * staged row gets a fresh id, so the document's id stays free for the ledger
 * row its deletion enqueues later.
 */
async function recordConfirmedFile(
	database: Database,
	access: PersonnelFileAccess,
	input: {
		batch: PayslipBatchView;
		prepared: Extract<PreparedCopy, { kind: "copy" }>;
		stored: StoredPersonnelFileObject;
		today: string;
		at: Date;
	},
): Promise<FileConfirmation> {
	const { prepared } = input;
	return database.transaction(async (tx): Promise<FileConfirmation> => {
		const [file] = await tx
			.select()
			.from(payslipBatchFile)
			.where(fileCondition(access, input.batch.id, prepared.file.id))
			.for("update");
		if (!file) return { kind: "skipped" };
		if (file.documentId) return { kind: "already" };
		const released = await tx
			.delete(personnelFileUpload)
			.where(
				and(
					eq(personnelFileUpload.id, prepared.targetLedgerId),
					eq(personnelFileUpload.organizationId, access.organizationId),
					eq(personnelFileUpload.storageKey, prepared.targetKey),
					eq(personnelFileUpload.status, "pending"),
				),
			)
			.returning({ id: personnelFileUpload.id });
		// Cleanup claimed the copy meanwhile: retry later.
		if (released.length !== 1) {
			return failFile(
				tx,
				access,
				{ batchId: input.batch.id, fileId: file.id, at: input.at },
				"error",
			);
		}
		await tx
			.update(personnelFileUpload)
			.set({
				id: randomUUID(),
				status: "cleanup_required",
				reason: "removed",
				nextAttemptAt: input.at,
				updatedAt: input.at,
			})
			.where(
				and(
					eq(personnelFileUpload.id, file.id),
					eq(personnelFileUpload.organizationId, access.organizationId),
					eq(personnelFileUpload.storageKey, file.storageKey),
					eq(personnelFileUpload.status, "pending"),
				),
			);
		const employeeId = prepared.employeeId;
		const title =
			file.originalFileName.trim().slice(0, DOCUMENT_TITLE_MAX_LENGTH).trim() || file.fileName;
		const [document] = await tx
			.insert(employeeDocument)
			.values({
				id: file.id,
				organizationId: access.organizationId,
				employeeId,
				category: "payslip",
				title,
				documentDate: input.today,
				payPeriodYear: input.batch.payPeriod.year,
				payPeriodMonth: input.batch.payPeriod.month,
				visibility: input.batch.visibility,
				expiryDate: null,
				storageProvider: PERSONNEL_DOCUMENT_STORAGE_PROVIDER,
				storageBucket: input.stored.bucket,
				storageKey: prepared.targetKey,
				storageVersionId: input.stored.versionId,
				fileName: file.fileName,
				mimeType: file.mimeType,
				sizeBytes: file.sizeBytes,
				checksumSha256: file.checksumSha256,
				uploadedBy: access.userId,
				updatedBy: access.userId,
				createdAt: input.at,
				updatedAt: input.at,
			})
			.returning();
		if (!document) throw new Error("Failed to record the payslip");
		await tx
			.update(payslipBatchFile)
			.set({ documentId: document.id, failure: null, updatedAt: input.at })
			.where(fileCondition(access, input.batch.id, file.id));
		await writeDocumentAudit(tx, {
			action: AuditAction.PERSONNEL_FILE_DOCUMENT_UPLOADED,
			actorUserId: access.userId,
			document,
			metadata: {
				fileName: document.fileName,
				mimeType: document.mimeType,
				sizeBytes: document.sizeBytes,
				payslipBatchId: input.batch.id,
			},
		});
		return { kind: "created", employeeId };
	});
}

/**
 * Confirms one file: stage the document object's ledger row, copy the staged
 * object to the employee's document key, then record the payslip. A failed
 * copy is handed to cleanup at once and the staged object stays for a retry.
 */
async function confirmFile(
	database: Database,
	access: PersonnelFileAccess,
	input: {
		batch: PayslipBatchView;
		fileId: string;
		inScope: ReadonlySet<string>;
		today: string;
		at: Date;
		copyObject: CopyPersonnelFileObject;
	},
): Promise<FileConfirmation> {
	const prepared = await prepareFileCopy(database, access, input);
	if (prepared.kind !== "copy") return prepared;
	let stored: StoredPersonnelFileObject;
	try {
		stored = await input.copyObject({
			organizationId: access.organizationId,
			sourceKey: prepared.file.storageKey,
			sourceBucket: prepared.file.storageBucket,
			sourceVersionId: prepared.file.storageVersionId,
			targetKey: prepared.targetKey,
		});
	} catch (error) {
		await markPersonnelFileUploadFailed(database, {
			documentId: prepared.targetLedgerId,
			organizationId: access.organizationId,
			employeeId: prepared.employeeId,
			uploadedBy: access.userId,
			storageKey: prepared.targetKey,
			stored: null,
			reason: "finalization_failed",
		});
		throw error;
	}
	return recordConfirmedFile(database, access, {
		batch: input.batch,
		prepared,
		stored,
		today: input.today,
		at: input.at,
	});
}

/**
 * Confirms the batch: every included file that is not a document yet becomes
 * a payslip of the employee it is assigned or uniquely matched to, with the
 * batch's pay period and visibility, its file name as the title and today (in
 * the organization's timezone) as the document date. Each payslip's object is
 * copied to the employee's key (like a single upload) and the staged batch
 * object goes to cleanup. Refused while an included file has no employee.
 * Safe to call again to retry failed files.
 */
export async function confirmPayslipBatch(
	database: Database,
	access: PersonnelFileAccess,
	input: { batchId: string; copyObject: CopyPersonnelFileObject },
	now: Instant = systemClock.nowInstant(),
): Promise<ConfirmPayslipBatchResult> {
	const batch = await loadOwnPayslipBatch(database, access, input.batchId);
	if (!batch) return { kind: "not_found" };
	const files = await loadFiles(database, access.organizationId, batch.id);
	const unresolved = files.filter(
		(file) => file.included && !file.documentId && effectiveEmployeeId(file) === null,
	);
	if (unresolved.length > 0) {
		return { kind: "unresolved", fileIds: unresolved.map((file) => file.id) };
	}

	const at = dateFromInstant(now);
	const today = (
		await loadOrganizationDay(database, { organizationId: access.organizationId, now })
	).today.toString();
	const inScope = new Set((await listPayslipCandidates(database, access)).map((e) => e.id));
	const earlier = new Set(
		files
			.filter((file) => file.documentId)
			.map(effectiveEmployeeId)
			.filter((id): id is string => id !== null),
	);

	const created: PayslipBatchFileOutcome[] = [];
	const failed: Array<PayslipBatchFileOutcome & { failure: PayslipFileFailure }> = [];
	let alreadyCreated = 0;
	for (const file of files) {
		if (!file.included || file.documentId) {
			if (file.documentId) alreadyCreated += 1;
			continue;
		}
		const outcome: PayslipBatchFileOutcome = {
			fileId: file.id,
			fileName: file.originalFileName,
			employeeId: effectiveEmployeeId(file),
		};
		let result: FileConfirmation;
		try {
			result = await confirmFile(database, access, {
				batch,
				fileId: file.id,
				inScope,
				today,
				at,
				copyObject: input.copyObject,
			});
		} catch {
			await database
				.update(payslipBatchFile)
				.set({ failure: "error", updatedAt: at })
				.where(
					and(
						eq(payslipBatchFile.id, file.id),
						eq(payslipBatchFile.organizationId, access.organizationId),
						isNull(payslipBatchFile.documentId),
					),
				);
			result = { kind: "failed", failure: "error" };
		}
		if (result.kind === "created") created.push({ ...outcome, employeeId: result.employeeId });
		else if (result.kind === "failed") failed.push({ ...outcome, failure: result.failure });
		else if (result.kind === "already") alreadyCreated += 1;
	}

	const dropped = files.filter((file) => !file.included && !file.documentId).length;
	const [confirmed] = await database
		.update(payslipBatch)
		.set({
			status: "confirmed",
			confirmedAt: sql`coalesce(${payslipBatch.confirmedAt}, ${at})`,
			updatedAt: at,
		})
		.where(ownBatchCondition(access, batch.id))
		.returning();
	if (failed.length === 0) {
		// Every included file is a document now: dropped files need no staging any more.
		await database
			.update(personnelFileUpload)
			.set({ status: "cleanup_required", reason: "removed", nextAttemptAt: at, updatedAt: at })
			.where(
				and(
					eq(personnelFileUpload.organizationId, access.organizationId),
					eq(personnelFileUpload.batchId, batch.id),
					eq(personnelFileUpload.status, "pending"),
				),
			);
	}
	await writePayslipBatchAudit(database, {
		organizationId: access.organizationId,
		batchId: batch.id,
		actorUserId: access.userId,
		metadata: {
			payPeriod: batch.payPeriod,
			visibility: batch.visibility,
			fileCount: files.length,
			created: created.length,
			failed: failed.length,
			alreadyCreated,
			dropped,
			failures: failed.map((file) => ({ fileId: file.fileId, failure: file.failure })),
		},
	});

	const createdPerEmployee = new Map<string, number>();
	for (const file of created) {
		if (!file.employeeId || earlier.has(file.employeeId)) continue;
		createdPerEmployee.set(file.employeeId, (createdPerEmployee.get(file.employeeId) ?? 0) + 1);
	}
	return {
		kind: "confirmed",
		batch: confirmed ? toBatchView(confirmed) : batch,
		created,
		failed,
		firstDocumentsFor: [...createdPerEmployee].map(([employeeId, documentCount]) => ({
			employeeId,
			documentCount,
		})),
	};
}

/**
 * Deletes open batches nobody touched for two days (#868). Their staged files
 * were already handed to the cleanup worker as abandoned uploads.
 */
export async function deleteAbandonedPayslipBatches(
	database: Database,
	now: Instant = systemClock.nowInstant(),
): Promise<number> {
	const before = dateFromInstant(now.subtract({ milliseconds: ABANDONED_PAYSLIP_BATCH_AFTER_MS }));
	const deleted = await database
		.delete(payslipBatch)
		.where(and(eq(payslipBatch.status, "open"), lt(payslipBatch.updatedAt, before)))
		.returning({ id: payslipBatch.id });
	return deleted.length;
}

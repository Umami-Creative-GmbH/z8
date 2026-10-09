import { and, desc, eq } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { employeeDocument, personnelFileUpload } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { canManageDocument, type PersonnelFileAccess } from "./access";
import { loadEmployeeRef, visibleDocumentsCondition } from "./access-store";
import { writeDocumentAudit } from "./audit";
import type { DocumentCategory, DocumentVisibility, PayPeriod } from "./document.types";
import { type DocumentMetadata, validateDocumentMetadata } from "./document-rules";
import type { StagedPersonnelFileUpload, StoredPersonnelFileObject } from "./upload-ledger";

/**
 * Writes and reads of employee documents (#865). Every write runs in one
 * transaction with its audit record and decides access with the resolver's
 * `PersonnelFileAccess`; every read filters with `visibleDocumentsCondition`.
 * A document that is not visible to the actor is reported as not found.
 */

type Database = typeof appDb;
type DocumentRow = typeof employeeDocument.$inferSelect;

export const PERSONNEL_DOCUMENT_STORAGE_PROVIDER = "s3-private";

/** Write-once object key under the organization and the employee. */
export function personnelDocumentStorageKey(input: {
	organizationId: string;
	employeeId: string;
	documentId: string;
	fileName: string;
}): string {
	return `personnel-files/${input.organizationId}/${input.employeeId}/${input.documentId}-${input.fileName}`;
}

export interface EmployeeDocumentView {
	id: string;
	employeeId: string;
	category: DocumentCategory;
	title: string;
	documentDate: string;
	payPeriod: PayPeriod | null;
	visibility: DocumentVisibility;
	expiryDate: string | null;
	fileName: string;
	mimeType: string;
	sizeBytes: number;
	/** ISO instant. */
	createdAt: string;
}

export function toDocumentView(row: DocumentRow): EmployeeDocumentView {
	return {
		id: row.id,
		employeeId: row.employeeId,
		category: row.category,
		title: row.title,
		documentDate: row.documentDate,
		payPeriod:
			row.payPeriodYear !== null && row.payPeriodMonth !== null
				? { year: row.payPeriodYear, month: row.payPeriodMonth }
				: null,
		visibility: row.visibility,
		expiryDate: row.expiryDate,
		fileName: row.fileName,
		mimeType: row.mimeType,
		sizeBytes: row.sizeBytes,
		createdAt: row.createdAt.toISOString(),
	};
}

function metadataColumns(metadata: DocumentMetadata) {
	return {
		category: metadata.category,
		title: metadata.title,
		documentDate: metadata.documentDate,
		payPeriodYear: metadata.payPeriod?.year ?? null,
		payPeriodMonth: metadata.payPeriod?.month ?? null,
		visibility: metadata.visibility,
		expiryDate: metadata.expiryDate,
	};
}

export type FinalizePersonnelDocumentResult =
	| { kind: "recorded"; document: EmployeeDocumentView; shareEventId: string | null }
	| { kind: "not_pending" };

/**
 * Records a stored object as an employee document and releases its staging
 * row in one transaction, with the upload audit record. The caller checked
 * access and validated the metadata before storing the object.
 */
export async function finalizePersonnelDocumentUpload(
	database: Database,
	input: StagedPersonnelFileUpload & {
		metadata: DocumentMetadata;
		stored: StoredPersonnelFileObject;
		fileName: string;
		mimeType: string;
		sizeBytes: number;
		checksumSha256: string;
		/** "employee" when the employee uploaded into their own file (#867). */
		source?: "employee";
	},
	now: Instant = systemClock.nowInstant(),
): Promise<FinalizePersonnelDocumentResult> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const released = await tx
			.delete(personnelFileUpload)
			.where(
				and(
					eq(personnelFileUpload.id, input.documentId),
					eq(personnelFileUpload.organizationId, input.organizationId),
					eq(personnelFileUpload.storageKey, input.storageKey),
					eq(personnelFileUpload.status, "pending"),
				),
			)
			.returning({ id: personnelFileUpload.id });
		if (released.length !== 1) return { kind: "not_pending" };
		const [row] = await tx
			.insert(employeeDocument)
			.values({
				id: input.documentId,
				organizationId: input.organizationId,
				employeeId: input.employeeId,
				...metadataColumns(input.metadata),
				storageProvider: PERSONNEL_DOCUMENT_STORAGE_PROVIDER,
				storageBucket: input.stored.bucket,
				storageKey: input.storageKey,
				storageVersionId: input.stored.versionId,
				fileName: input.fileName,
				mimeType: input.mimeType,
				sizeBytes: input.sizeBytes,
				checksumSha256: input.checksumSha256,
				uploadedBy: input.uploadedBy,
				updatedBy: input.uploadedBy,
				createdAt: at,
				updatedAt: at,
			})
			.returning();
		if (!row) throw new Error("Failed to record the employee document");
		const auditId = await writeDocumentAudit(tx, {
			action: AuditAction.PERSONNEL_FILE_DOCUMENT_UPLOADED,
			actorUserId: input.uploadedBy,
			document: row,
			metadata: {
				fileName: row.fileName,
				mimeType: row.mimeType,
				sizeBytes: row.sizeBytes,
				...(input.source ? { source: input.source } : {}),
			},
		});
		return {
			kind: "recorded",
			document: toDocumentView(row),
			shareEventId: row.visibility === "shared" ? auditId : null,
		};
	});
}

async function lockDocument(
	tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
	organizationId: string,
	documentId: string,
): Promise<DocumentRow | null> {
	const [row] = await tx
		.select()
		.from(employeeDocument)
		.where(
			and(eq(employeeDocument.id, documentId), eq(employeeDocument.organizationId, organizationId)),
		)
		.for("update");
	return row ?? null;
}

export type UpdateDocumentMetadataResult =
	| { kind: "updated"; document: EmployeeDocumentView; shareEventId: string | null }
	| { kind: "unchanged"; document: EmployeeDocumentView }
	| { kind: "invalid"; field: string; message: string }
	| { kind: "not_found" };

const AUDITED_METADATA_FIELDS = [
	"category",
	"title",
	"documentDate",
	"payPeriodYear",
	"payPeriodMonth",
	"expiryDate",
] as const;

/**
 * Edits a document's metadata (never its file). A visibility change gets its
 * own audit record with the old and new value; becoming shared returns the
 * id of that record so the employee is notified exactly once per change.
 */
export async function updateDocumentMetadata(
	database: Database,
	access: PersonnelFileAccess,
	input: {
		documentId: string;
		metadata: {
			category: unknown;
			title: unknown;
			documentDate: unknown;
			payPeriod: unknown;
			visibility: unknown;
			expiryDate: unknown;
		};
	},
	now: Instant = systemClock.nowInstant(),
): Promise<UpdateDocumentMetadataResult> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const current = await lockDocument(tx, access.organizationId, input.documentId);
		if (!current) return { kind: "not_found" };
		const employeeRef = await loadEmployeeRef(tx, {
			organizationId: access.organizationId,
			employeeId: current.employeeId,
		});
		if (!employeeRef || !canManageDocument(access, employeeRef, current.category)) {
			return { kind: "not_found" };
		}
		const validated = validateDocumentMetadata(input.metadata);
		if (!validated.ok) {
			return { kind: "invalid", field: validated.field, message: validated.message };
		}
		if (!canManageDocument(access, employeeRef, validated.value.category)) {
			return {
				kind: "invalid",
				field: "category",
				message: "You cannot move documents into this category.",
			};
		}
		const next = metadataColumns(validated.value);
		const changes: Record<string, { from: unknown; to: unknown }> = {};
		for (const field of AUDITED_METADATA_FIELDS) {
			if (current[field] !== next[field])
				changes[field] = { from: current[field], to: next[field] };
		}
		const visibilityChanged = current.visibility !== next.visibility;
		if (Object.keys(changes).length === 0 && !visibilityChanged) {
			return { kind: "unchanged", document: toDocumentView(current) };
		}
		const [row] = await tx
			.update(employeeDocument)
			.set({ ...next, updatedBy: access.userId, updatedAt: at })
			.where(
				and(
					eq(employeeDocument.id, current.id),
					eq(employeeDocument.organizationId, access.organizationId),
				),
			)
			.returning();
		if (!row) return { kind: "not_found" };
		if (Object.keys(changes).length > 0) {
			await writeDocumentAudit(tx, {
				action: AuditAction.PERSONNEL_FILE_DOCUMENT_UPDATED,
				actorUserId: access.userId,
				document: row,
				changes,
			});
		}
		let shareEventId: string | null = null;
		if (visibilityChanged) {
			const auditId = await writeDocumentAudit(tx, {
				action: AuditAction.PERSONNEL_FILE_VISIBILITY_CHANGED,
				actorUserId: access.userId,
				document: row,
				changes: { visibility: { from: current.visibility, to: row.visibility } },
			});
			if (row.visibility === "shared") shareEventId = auditId;
		}
		return { kind: "updated", document: toDocumentView(row), shareEventId };
	});
}

export type DeleteDocumentResult = { kind: "deleted"; documentId: string } | { kind: "not_found" };

/**
 * Deletes a document with an audit record and the optional reason. The
 * deletion trigger hands its stored object to the cleanup ledger in the same
 * transaction, so it is deleted durably even when the immediate attempt fails.
 */
export async function deleteDocument(
	database: Database,
	access: PersonnelFileAccess,
	input: { documentId: string; reason: string | null },
	now: Instant = systemClock.nowInstant(),
): Promise<DeleteDocumentResult> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const current = await lockDocument(tx, access.organizationId, input.documentId);
		if (!current) return { kind: "not_found" };
		const employeeRef = await loadEmployeeRef(tx, {
			organizationId: access.organizationId,
			employeeId: current.employeeId,
		});
		if (!employeeRef || !canManageDocument(access, employeeRef, current.category)) {
			return { kind: "not_found" };
		}
		await tx
			.delete(employeeDocument)
			.where(
				and(
					eq(employeeDocument.id, current.id),
					eq(employeeDocument.organizationId, access.organizationId),
				),
			);
		// The trigger stamps database time; align it with the clock the worker uses.
		await tx
			.update(personnelFileUpload)
			.set({ nextAttemptAt: at, createdAt: at, updatedAt: at })
			.where(
				and(
					eq(personnelFileUpload.id, current.id),
					eq(personnelFileUpload.organizationId, access.organizationId),
					eq(personnelFileUpload.status, "cleanup_required"),
				),
			);
		await writeDocumentAudit(tx, {
			action: AuditAction.PERSONNEL_FILE_DOCUMENT_DELETED,
			actorUserId: access.userId,
			document: current,
			metadata: { reason: input.reason, fileName: current.fileName },
		});
		return { kind: "deleted", documentId: current.id };
	});
}

/** Documents of one employee the actor may see, newest document date first. */
export async function listEmployeeDocuments(
	database: Database,
	access: PersonnelFileAccess,
	input: { employeeId: string; category?: DocumentCategory | null },
): Promise<EmployeeDocumentView[]> {
	const rows = await database
		.select()
		.from(employeeDocument)
		.where(
			and(
				visibleDocumentsCondition(access),
				eq(employeeDocument.employeeId, input.employeeId),
				input.category ? eq(employeeDocument.category, input.category) : undefined,
			),
		)
		.orderBy(
			desc(employeeDocument.documentDate),
			desc(employeeDocument.createdAt),
			desc(employeeDocument.id),
		);
	return rows.map(toDocumentView);
}

/** The actor's own shared documents ("My documents"), also for an owner or admin. */
export async function listOwnSharedDocuments(
	database: Database,
	access: PersonnelFileAccess,
): Promise<EmployeeDocumentView[]> {
	if (!access.selfEmployeeId) return [];
	const rows = await database
		.select()
		.from(employeeDocument)
		.where(
			and(
				eq(employeeDocument.organizationId, access.organizationId),
				eq(employeeDocument.employeeId, access.selfEmployeeId),
				eq(employeeDocument.visibility, "shared"),
			),
		)
		.orderBy(
			desc(employeeDocument.documentDate),
			desc(employeeDocument.createdAt),
			desc(employeeDocument.id),
		);
	return rows.map(toDocumentView);
}

/** A document the actor may see, with its stored object, for serving it. */
export async function loadVisibleDocument(
	database: Database,
	access: PersonnelFileAccess,
	documentId: string,
): Promise<DocumentRow | null> {
	const [row] = await database
		.select()
		.from(employeeDocument)
		.where(and(eq(employeeDocument.id, documentId), visibleDocumentsCondition(access)))
		.limit(1);
	return row ?? null;
}

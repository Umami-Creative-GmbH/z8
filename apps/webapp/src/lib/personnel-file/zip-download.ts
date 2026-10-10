import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { auditLog, employeeDocument } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { createLogger } from "@/lib/logger";
import { createStoredZipStream } from "@/lib/storage/stored-zip-stream";
import { managedCategoriesFor, type PersonnelFileAccess } from "./access";
import { listManagedEmployees, loadEmployeeRef, type ManagedEmployee } from "./access-store";
import { DOCUMENT_CATEGORIES, type DocumentCategory } from "./document.types";
import { readVerifiedDocumentObject } from "./document-object";
import { personnelFileZipEntryNames } from "./zip-entries";

/**
 * Downloading one employee's personnel file as a ZIP (#871), for example to
 * hand it over to a former employee (ADR 0001). It holds the documents of the
 * categories the actor manages for that employee (never the actor's own
 * shared documents through the employee path), optionally shared ones only.
 * Each download is audited once with the list of included documents, before
 * any content leaves; the archive is then streamed one file at a time. A
 * download that aborts mid-stream gets a follow-up record naming the failed
 * document and the documents actually handed over.
 */

const logger = createLogger("PersonnelFileZip");

type Database = typeof appDb;
type DocumentRow = typeof employeeDocument.$inferSelect;

export const PERSONNEL_FILE_ZIP_AUDIT_ENTITY_TYPE = "employee_personnel_file";

export interface PersonnelFileZipPlan {
	organizationId: string;
	employee: ManagedEmployee;
	sharedOnly: boolean;
	/** The categories the actor manages for the employee, in display order. */
	categories: DocumentCategory[];
	entries: Array<{ document: DocumentRow; entryName: string }>;
}

/** What a ZIP download would contain; null when the actor manages none of the employee's documents. */
export async function planPersonnelFileZip(
	database: Database,
	access: PersonnelFileAccess,
	input: { employeeId: string; sharedOnly: boolean },
): Promise<PersonnelFileZipPlan | null> {
	const [managed] = await listManagedEmployees(database, access, { employeeId: input.employeeId });
	if (!managed) return null;
	const employeeRef = await loadEmployeeRef(database, {
		organizationId: access.organizationId,
		employeeId: managed.id,
	});
	if (!employeeRef) return null;
	const managedCategories = managedCategoriesFor(access, employeeRef);
	const categories = DOCUMENT_CATEGORIES.filter((category) => managedCategories.has(category));
	if (categories.length === 0) return null;

	const rows = await database
		.select()
		.from(employeeDocument)
		.where(
			and(
				eq(employeeDocument.organizationId, access.organizationId),
				eq(employeeDocument.employeeId, managed.id),
				inArray(employeeDocument.category, categories),
				input.sharedOnly ? eq(employeeDocument.visibility, "shared") : undefined,
			),
		)
		.orderBy(
			asc(employeeDocument.documentDate),
			asc(employeeDocument.createdAt),
			asc(employeeDocument.id),
		);
	const ordered = categories.flatMap((category) => rows.filter((row) => row.category === category));
	const names = personnelFileZipEntryNames(ordered);
	return {
		organizationId: access.organizationId,
		employee: managed,
		sharedOnly: input.sharedOnly,
		categories,
		entries: ordered.map((document, index) => ({ document, entryName: names[index] as string })),
	};
}

/** The one audit record of a ZIP download, listing every included document. */
export async function writePersonnelFileZipAudit(
	database: Database,
	input: {
		actorUserId: string;
		plan: PersonnelFileZipPlan;
		ipAddress?: string | null;
		userAgent?: string | null;
	},
): Promise<string> {
	const id = randomUUID();
	const { plan } = input;
	await database.insert(auditLog).values({
		id,
		organizationId: plan.organizationId,
		entityType: PERSONNEL_FILE_ZIP_AUDIT_ENTITY_TYPE,
		entityId: plan.employee.id,
		action: AuditAction.PERSONNEL_FILE_ZIP_DOWNLOADED,
		performedBy: input.actorUserId,
		employeeId: plan.employee.id,
		metadata: JSON.stringify({
			sharedOnly: plan.sharedOnly,
			categories: plan.categories,
			formerEmployee: !plan.employee.isActive,
			documents: plan.entries.map(({ document, entryName }) => ({
				id: document.id,
				category: document.category,
				title: document.title,
				documentDate: document.documentDate,
				visibility: document.visibility,
				fileName: document.fileName,
				sizeBytes: document.sizeBytes,
				entryName,
			})),
		}),
		ipAddress: input.ipAddress ?? null,
		userAgent: input.userAgent ?? null,
	});
	return id;
}

export interface PersonnelFileZipAbort {
	failedDocument: { id: string; entryName: string };
	/** The documents handed to the archive before the failure, in order. */
	deliveredDocumentIds: string[];
}

/**
 * The follow-up audit record of an aborted ZIP download: the up-front record
 * lists the planned documents, this one the document that failed and the
 * documents actually handed over.
 */
export async function writePersonnelFileZipAbortAudit(
	database: Database,
	input: {
		actorUserId: string;
		plan: PersonnelFileZipPlan;
		downloadAuditId: string;
		abort: PersonnelFileZipAbort;
		ipAddress?: string | null;
		userAgent?: string | null;
	},
): Promise<void> {
	await database.insert(auditLog).values({
		id: randomUUID(),
		organizationId: input.plan.organizationId,
		entityType: PERSONNEL_FILE_ZIP_AUDIT_ENTITY_TYPE,
		entityId: input.plan.employee.id,
		action: AuditAction.PERSONNEL_FILE_ZIP_DOWNLOAD_ABORTED,
		performedBy: input.actorUserId,
		employeeId: input.plan.employee.id,
		metadata: JSON.stringify({
			downloadAuditId: input.downloadAuditId,
			failedDocument: input.abort.failedDocument,
			deliveredDocumentIds: input.abort.deliveredDocumentIds,
		}),
		ipAddress: input.ipAddress ?? null,
		userAgent: input.userAgent ?? null,
	});
}

/**
 * The archive as a stream. Files are read and verified one at a time, only as
 * the client consumes the download, so memory stays bounded by one document
 * however large the personnel file is. A file that fails verification aborts
 * the download rather than handing over an incomplete file unnoticed;
 * `onAbort` records which document failed and which were handed over before
 * the stream errors.
 */
export function streamPersonnelFileZip(
	plan: PersonnelFileZipPlan,
	options: { onAbort?: (abort: PersonnelFileZipAbort) => Promise<void> } = {},
): ReadableStream<Uint8Array> {
	const delivered: string[] = [];
	return createStoredZipStream(
		plan.entries.map(({ document, entryName }) => ({
			name: entryName,
			date: document.documentDate,
			read: async () => {
				try {
					const bytes = await readVerifiedDocumentObject(document);
					delivered.push(document.id);
					return bytes;
				} catch (error) {
					logger.error(
						{ error, documentId: document.id, organizationId: document.organizationId },
						"Aborted a personnel file download: a document could not be read",
					);
					await options
						.onAbort?.({
							failedDocument: { id: document.id, entryName },
							deliveredDocumentIds: [...delivered],
						})
						.catch((auditError) =>
							logger.error(
								{ error: auditError, documentId: document.id },
								"Failed to audit an aborted personnel file download",
							),
						);
					throw error;
				}
			},
		})),
	);
}

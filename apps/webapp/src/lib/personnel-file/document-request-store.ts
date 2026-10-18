import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Temporal } from "temporal-polyfill";
import type { db as appDb } from "@/db";
import { user } from "@/db/auth-schema";
import {
	auditLog,
	employee,
	employeeDocument,
	employeeDocumentRequest,
	employeeDocumentRequestDocument,
	employeeDocumentRequestEvent,
	employeeDocumentRequestSubmission,
} from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import {
	canManageDocumentRequest,
	type EmployeeRef,
	isOwnDocument,
	managedCategoriesFor,
	type PersonnelFileAccess,
} from "./access";
import {
	loadEmployeeRef,
	managedDocumentRequestsCondition,
	visibleDocumentsCondition,
} from "./access-store";
import {
	ACTIVE_DOCUMENT_REQUEST_STATUSES,
	DOCUMENT_REQUEST_CATEGORIES,
	type DocumentRequestEventChanges,
	type DocumentRequestEventKind,
	type DocumentRequestFollowUpEventKind,
	type DocumentRequestReasonCode,
	type DocumentRequestRefusal,
	type DocumentRequestStatus,
	type DocumentRequestView,
} from "./document-request.types";
import {
	isDocumentRequestOverdue,
	nextDocumentRequestStatus,
	validateDocumentRequestInput,
	validateDocumentRequestReason,
} from "./document-request-rules";
import { lockDocument } from "./document-store";
import { loadOrganizationDay } from "./organization-day";

/**
 * The one store of document requests (#1307, ADR 0003). Every write runs in
 * one transaction with its history event and its personnel-file audit record,
 * under the request's row lock, and decides access with the resolver's
 * `PersonnelFileAccess` (`canManageDocumentRequest`: whoever covers the
 * employee and the category now; never on one's own file). Every read is
 * scoped to the organization; officers read through
 * `managedDocumentRequestsCondition`, the employee only their own requests.
 *
 * Later slices extend it rather than fork it:
 * - `lockManagedDocumentRequest` + `applyDocumentRequestEvent` for officer
 *   events (return, accept, edit), `lockDocumentRequest` + the same helper for
 *   the employee's submit and for system events (departure).
 * - `toDocumentRequestViews` for every list.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Pick<Transaction, "select">;
export type DocumentRequestRow = typeof employeeDocumentRequest.$inferSelect;

export const DOCUMENT_REQUEST_AUDIT_ENTITY_TYPE = "employee_document_request";

const EVENT_AUDIT_ACTIONS: Readonly<Record<DocumentRequestEventKind, AuditAction>> = {
	created: AuditAction.PERSONNEL_FILE_DOCUMENT_REQUEST_CREATED,
	edited: AuditAction.PERSONNEL_FILE_DOCUMENT_REQUEST_EDITED,
	submitted: AuditAction.PERSONNEL_FILE_DOCUMENT_REQUEST_SUBMITTED,
	returned: AuditAction.PERSONNEL_FILE_DOCUMENT_REQUEST_RETURNED,
	accepted: AuditAction.PERSONNEL_FILE_DOCUMENT_REQUEST_ACCEPTED,
	cancelled: AuditAction.PERSONNEL_FILE_DOCUMENT_REQUEST_CANCELLED,
};

/**
 * The audit record of one history event. Its metadata keeps the request's
 * category, title, deadline and renewed document so it explains itself after
 * the request is gone. `request.note`, `reason` and `submissionNote` are
 * document descriptions (#1408 removes them on purge).
 */
async function writeDocumentRequestAudit(
	tx: Pick<Transaction, "insert">,
	input: {
		kind: DocumentRequestEventKind;
		actorUserId: string;
		request: DocumentRequestRow;
		eventId: string;
		at: Date;
		metadata?: Record<string, unknown>;
	},
): Promise<void> {
	const { request } = input;
	await tx.insert(auditLog).values({
		organizationId: request.organizationId,
		entityType: DOCUMENT_REQUEST_AUDIT_ENTITY_TYPE,
		entityId: request.id,
		action: EVENT_AUDIT_ACTIONS[input.kind],
		performedBy: input.actorUserId,
		employeeId: request.employeeId,
		metadata: JSON.stringify({
			request: {
				category: request.category,
				title: request.title,
				deadline: request.deadline,
				renewedDocumentId: request.renewedDocumentId,
				...(input.kind === "created" ? { note: request.note } : {}),
			},
			eventId: input.eventId,
			...input.metadata,
		}),
		timestamp: input.at,
	});
}

/** The request of the organization, locked for the rest of the transaction. */
export async function lockDocumentRequest(
	tx: Transaction,
	organizationId: string,
	requestId: string,
): Promise<DocumentRequestRow | null> {
	const [row] = await tx
		.select()
		.from(employeeDocumentRequest)
		.where(
			and(
				eq(employeeDocumentRequest.id, requestId),
				eq(employeeDocumentRequest.organizationId, organizationId),
			),
		)
		.for("update");
	return row ?? null;
}

export type ManagedDocumentRequestLookup =
	| { kind: "managed"; request: DocumentRequestRow; employee: EmployeeRef }
	/** Not in the organization, or the actor does not cover its employee and category now. */
	| { kind: "not_found" }
	/** The request is on the actor's own file. */
	| { kind: "refused"; reason: "own_file" };

/**
 * Locks a request an officer acts on and re-checks, under the lock, that the
 * actor covers its employee and category now (lost coverage = not found).
 */
export async function lockManagedDocumentRequest(
	tx: Transaction,
	access: PersonnelFileAccess,
	requestId: string,
): Promise<ManagedDocumentRequestLookup> {
	const request = await lockDocumentRequest(tx, access.organizationId, requestId);
	if (!request) return { kind: "not_found" };
	if (isOwnDocument(access, request.employeeId)) return { kind: "refused", reason: "own_file" };
	const employeeRef = await loadEmployeeRef(tx, {
		organizationId: access.organizationId,
		employeeId: request.employeeId,
	});
	if (!employeeRef || !canManageDocumentRequest(access, employeeRef, request.category)) {
		return { kind: "not_found" };
	}
	return { kind: "managed", request, employee: employeeRef };
}

export interface DocumentRequestEventInput {
	kind: DocumentRequestFollowUpEventKind;
	/** Who acts; recorded in the history and as the audit record's performer. */
	actorUserId: string;
	/** A return's or cancel's typed reason. */
	reason?: string | null;
	/** A system reason instead of a typed one (#1408). */
	reasonCode?: DocumentRequestReasonCode | null;
	/** The submission a `submitted` event hands in (#1402). */
	submissionId?: string | null;
	/** An edit's new deadline and note (#1403); recorded as `changes`. */
	patch?: { deadline?: string; note?: string | null };
	/** Extra audit metadata (e.g. `submissionNote`). */
	auditMetadata?: Record<string, unknown>;
}

export type ApplyDocumentRequestEventResult =
	| { kind: "applied"; request: DocumentRequestRow; eventId: string }
	/** The request moved on (another decision won) or the caller's view is stale. */
	| { kind: "conflict"; status: DocumentRequestStatus };

/**
 * Applies one event to a request the caller locked and authorized: checks the
 * lifecycle step (`nextDocumentRequestStatus`) and the caller's
 * `expectedVersion`, moves the status, bumps the version, records the history
 * event and the audit record. The update is guarded by the status and version
 * it read as well, so a decision can never overwrite a concurrent one.
 */
export async function applyDocumentRequestEvent(
	tx: Transaction,
	input: {
		request: DocumentRequestRow;
		event: DocumentRequestEventInput;
		/** The version the actor saw; omitted, only the lifecycle step is checked. */
		expectedVersion?: number | null;
		now?: Instant;
	},
): Promise<ApplyDocumentRequestEventResult> {
	const { request, event } = input;
	const at = dateFromInstant(input.now ?? systemClock.nowInstant());
	const next = nextDocumentRequestStatus(request.status, event.kind);
	if (
		next === null ||
		(input.expectedVersion !== undefined &&
			input.expectedVersion !== null &&
			input.expectedVersion !== request.version)
	) {
		return { kind: "conflict", status: request.status };
	}
	const changes: DocumentRequestEventChanges = {};
	const patch: Partial<Pick<DocumentRequestRow, "deadline" | "note">> = {};
	if (event.patch?.deadline !== undefined && event.patch.deadline !== request.deadline) {
		changes.deadline = { from: request.deadline, to: event.patch.deadline };
		patch.deadline = event.patch.deadline;
	}
	if (event.patch?.note !== undefined && event.patch.note !== request.note) {
		changes.noteChanged = true;
		patch.note = event.patch.note;
	}
	const [updated] = await tx
		.update(employeeDocumentRequest)
		.set({ ...patch, status: next, version: request.version + 1, updatedAt: at })
		.where(
			and(
				eq(employeeDocumentRequest.id, request.id),
				eq(employeeDocumentRequest.organizationId, request.organizationId),
				eq(employeeDocumentRequest.status, request.status),
				eq(employeeDocumentRequest.version, request.version),
			),
		)
		.returning();
	if (!updated) return { kind: "conflict", status: request.status };
	const hasChanges = Object.keys(changes).length > 0;
	const [recorded] = await tx
		.insert(employeeDocumentRequestEvent)
		.values({
			organizationId: request.organizationId,
			requestId: request.id,
			kind: event.kind,
			actorUserId: event.actorUserId,
			reason: event.reason ?? null,
			reasonCode: event.reasonCode ?? null,
			submissionId: event.submissionId ?? null,
			changes: hasChanges ? changes : null,
			occurredAt: at,
		})
		.returning({ id: employeeDocumentRequestEvent.id });
	if (!recorded) throw new Error("Failed to record the document request event");
	await writeDocumentRequestAudit(tx, {
		kind: event.kind,
		actorUserId: event.actorUserId,
		request: updated,
		eventId: recorded.id,
		at,
		metadata: {
			status: { from: request.status, to: next },
			...(event.reason ? { reason: event.reason } : {}),
			...(event.reasonCode ? { reasonCode: event.reasonCode } : {}),
			...(event.submissionId ? { submissionId: event.submissionId } : {}),
			...(hasChanges ? { changes } : {}),
			...event.auditMetadata,
		},
	});
	return { kind: "applied", request: updated, eventId: recorded.id };
}

export type CreateDocumentRequestResult =
	| { kind: "created"; request: DocumentRequestView; eventId: string }
	| { kind: "not_found" }
	| { kind: "refused"; reason: DocumentRequestRefusal };

/**
 * Creates an open request for one employee and one requestable category, by a
 * covering officer, an owner or an admin, never on their own file, never for a
 * former employee. A renewed document (#1404) must be a document of the same
 * employee and category; it is locked, so of two concurrent requests naming
 * it only the first is created.
 */
export async function createDocumentRequest(
	database: Database,
	access: PersonnelFileAccess,
	input: {
		employeeId: string;
		category: unknown;
		title: unknown;
		note: unknown;
		deadline: unknown;
		renewedDocumentId?: string | null;
	},
	now: Instant = systemClock.nowInstant(),
): Promise<CreateDocumentRequestResult> {
	const at = dateFromInstant(now);
	const { today } = await loadOrganizationDay(database, {
		organizationId: access.organizationId,
		now,
	});
	const validated = validateDocumentRequestInput(input, today);
	if (!validated.ok) return { kind: "refused", reason: validated.reason };
	const value = validated.value;

	return database.transaction(async (tx): Promise<CreateDocumentRequestResult> => {
		const employeeRef = await loadEmployeeRef(tx, {
			organizationId: access.organizationId,
			employeeId: input.employeeId,
		});
		if (!employeeRef) return { kind: "not_found" };
		if (isOwnDocument(access, employeeRef.id)) return { kind: "refused", reason: "own_file" };
		if (!canManageDocumentRequest(access, employeeRef, value.category)) {
			return { kind: "not_found" };
		}
		const [current] = await tx
			.select({ hasAccess: employeeHasOrganizationAccess(now) })
			.from(employee)
			.where(
				and(eq(employee.id, employeeRef.id), eq(employee.organizationId, access.organizationId)),
			)
			.limit(1);
		if (!current?.hasAccess) return { kind: "refused", reason: "former_employee" };

		const renewedDocumentId = input.renewedDocumentId ?? null;
		if (renewedDocumentId !== null) {
			const renewed = await lockDocument(tx, access.organizationId, renewedDocumentId);
			if (
				!renewed ||
				renewed.employeeId !== employeeRef.id ||
				renewed.category !== value.category
			) {
				return { kind: "refused", reason: "renewed_document_mismatch" };
			}
			const [active] = await tx
				.select({ id: employeeDocumentRequest.id })
				.from(employeeDocumentRequest)
				.where(
					and(
						eq(employeeDocumentRequest.organizationId, access.organizationId),
						eq(employeeDocumentRequest.renewedDocumentId, renewedDocumentId),
						inArray(employeeDocumentRequest.status, [...ACTIVE_DOCUMENT_REQUEST_STATUSES]),
					),
				)
				.limit(1);
			if (active) return { kind: "refused", reason: "renewal_already_requested" };
		}

		const [row] = await tx
			.insert(employeeDocumentRequest)
			.values({
				organizationId: access.organizationId,
				employeeId: employeeRef.id,
				category: value.category,
				title: value.title,
				note: value.note,
				deadline: value.deadline,
				renewedDocumentId,
				status: "open",
				version: 1,
				createdBy: access.userId,
				createdAt: at,
				updatedAt: at,
			})
			.returning();
		if (!row) throw new Error("Failed to record the document request");
		const [event] = await tx
			.insert(employeeDocumentRequestEvent)
			.values({
				organizationId: access.organizationId,
				requestId: row.id,
				kind: "created",
				actorUserId: access.userId,
				occurredAt: at,
			})
			.returning({ id: employeeDocumentRequestEvent.id });
		if (!event) throw new Error("Failed to record the document request event");
		await writeDocumentRequestAudit(tx, {
			kind: "created",
			actorUserId: access.userId,
			request: row,
			eventId: event.id,
			at,
		});
		const [view] = await toDocumentRequestViews(tx, access, [row], today);
		if (!view) throw new Error("Failed to read the document request");
		return { kind: "created", request: view, eventId: event.id };
	});
}

export type CancelDocumentRequestResult =
	| { kind: "cancelled"; request: DocumentRequestView; eventId: string }
	| { kind: "not_found" }
	| { kind: "conflict" }
	| { kind: "refused"; reason: DocumentRequestRefusal };

/**
 * Cancels an open or submitted request with a required reason, by whoever
 * covers it now. The employee cannot cancel (or decline) their own request.
 */
export async function cancelDocumentRequest(
	database: Database,
	access: PersonnelFileAccess,
	input: { requestId: string; reason: unknown; expectedVersion?: number | null },
	now: Instant = systemClock.nowInstant(),
): Promise<CancelDocumentRequestResult> {
	const reason = validateDocumentRequestReason(input.reason);
	if (!reason.ok) return { kind: "refused", reason: reason.reason };
	const { today } = await loadOrganizationDay(database, {
		organizationId: access.organizationId,
		now,
	});
	return database.transaction(async (tx): Promise<CancelDocumentRequestResult> => {
		const lookup = await lockManagedDocumentRequest(tx, access, input.requestId);
		if (lookup.kind !== "managed") return lookup;
		const applied = await applyDocumentRequestEvent(tx, {
			request: lookup.request,
			event: { kind: "cancelled", actorUserId: access.userId, reason: reason.value },
			expectedVersion: input.expectedVersion,
			now,
		});
		if (applied.kind === "conflict") return { kind: "conflict" };
		const [view] = await toDocumentRequestViews(tx, access, [applied.request], today);
		if (!view) throw new Error("Failed to read the document request");
		return { kind: "cancelled", request: view, eventId: applied.eventId };
	});
}

const NEWEST_FIRST = [
	desc(employeeDocumentRequest.createdAt),
	desc(employeeDocumentRequest.id),
] as const;

/**
 * The actor's own requests ("Requested documents" in My documents), every
 * status, newest first. An owner or admin sees theirs here as the employee.
 */
export async function listOwnDocumentRequests(
	database: Database,
	access: PersonnelFileAccess,
	now: Instant = systemClock.nowInstant(),
): Promise<DocumentRequestView[]> {
	if (!access.selfEmployeeId) return [];
	const rows = await database
		.select()
		.from(employeeDocumentRequest)
		.where(
			and(
				eq(employeeDocumentRequest.organizationId, access.organizationId),
				eq(employeeDocumentRequest.employeeId, access.selfEmployeeId),
			),
		)
		.orderBy(...NEWEST_FIRST);
	const { today } = await loadOrganizationDay(database, {
		organizationId: access.organizationId,
		now,
	});
	return toDocumentRequestViews(database, access, rows, today);
}

/**
 * One employee's requests the actor covers as an officer (the requests
 * section of the employee's file), newest first. Null when the actor covers
 * no requestable category of the employee (or it is their own file).
 */
export async function listEmployeeDocumentRequests(
	database: Database,
	access: PersonnelFileAccess,
	employeeId: string,
	now: Instant = systemClock.nowInstant(),
): Promise<DocumentRequestView[] | null> {
	const employeeRef = await loadEmployeeRef(database, {
		organizationId: access.organizationId,
		employeeId,
	});
	if (!employeeRef) return null;
	const managed = managedCategoriesFor(access, employeeRef);
	if (!DOCUMENT_REQUEST_CATEGORIES.some((category) => managed.has(category))) return null;
	const rows = await database
		.select()
		.from(employeeDocumentRequest)
		.where(
			and(
				managedDocumentRequestsCondition(access),
				eq(employeeDocumentRequest.employeeId, employeeRef.id),
			),
		)
		.orderBy(...NEWEST_FIRST);
	const { today } = await loadOrganizationDay(database, {
		organizationId: access.organizationId,
		now,
	});
	return toDocumentRequestViews(database, access, rows, today);
}

/**
 * Requests as the actor may see them, with history and submissions. The
 * renewed document and the submitted documents are included only when the
 * actor may see them (`visibleDocumentsCondition`): an employee never sees an
 * HR-only renewed document. `today` is the organization's day (overdue).
 */
export async function toDocumentRequestViews(
	database: Reader,
	access: PersonnelFileAccess,
	rows: readonly DocumentRequestRow[],
	today: Temporal.PlainDate,
): Promise<DocumentRequestView[]> {
	if (rows.length === 0) return [];
	const organizationId = access.organizationId;
	const requestIds = rows.map((row) => row.id);
	const renewedIds = [
		...new Set(rows.flatMap((row) => (row.renewedDocumentId ? [row.renewedDocumentId] : []))),
	];
	const creatorIds = [...new Set(rows.flatMap((row) => (row.createdBy ? [row.createdBy] : [])))];
	const [events, submissions, linkedDocuments, renewed, creators] = await Promise.all([
		database
			.select({
				id: employeeDocumentRequestEvent.id,
				requestId: employeeDocumentRequestEvent.requestId,
				kind: employeeDocumentRequestEvent.kind,
				actorName: user.name,
				reason: employeeDocumentRequestEvent.reason,
				reasonCode: employeeDocumentRequestEvent.reasonCode,
				submissionId: employeeDocumentRequestEvent.submissionId,
				changes: employeeDocumentRequestEvent.changes,
				occurredAt: employeeDocumentRequestEvent.occurredAt,
			})
			.from(employeeDocumentRequestEvent)
			.leftJoin(user, eq(user.id, employeeDocumentRequestEvent.actorUserId))
			.where(
				and(
					eq(employeeDocumentRequestEvent.organizationId, organizationId),
					inArray(employeeDocumentRequestEvent.requestId, requestIds),
				),
			)
			.orderBy(asc(employeeDocumentRequestEvent.occurredAt), asc(employeeDocumentRequestEvent.id)),
		database
			.select()
			.from(employeeDocumentRequestSubmission)
			.where(
				and(
					eq(employeeDocumentRequestSubmission.organizationId, organizationId),
					inArray(employeeDocumentRequestSubmission.requestId, requestIds),
				),
			)
			.orderBy(
				asc(employeeDocumentRequestSubmission.submittedAt),
				asc(employeeDocumentRequestSubmission.id),
			),
		database
			.select({
				submissionId: employeeDocumentRequestDocument.submissionId,
				id: employeeDocument.id,
				title: employeeDocument.title,
				fileName: employeeDocument.fileName,
				mimeType: employeeDocument.mimeType,
			})
			.from(employeeDocumentRequestDocument)
			.innerJoin(
				employeeDocument,
				and(
					eq(employeeDocument.id, employeeDocumentRequestDocument.documentId),
					eq(employeeDocument.organizationId, employeeDocumentRequestDocument.organizationId),
				),
			)
			.where(
				and(
					eq(employeeDocumentRequestDocument.organizationId, organizationId),
					inArray(employeeDocumentRequestDocument.requestId, requestIds),
					isNotNull(employeeDocumentRequestDocument.submissionId),
					visibleDocumentsCondition(access),
				),
			)
			.orderBy(asc(employeeDocument.createdAt), asc(employeeDocument.id)),
		renewedIds.length === 0
			? Promise.resolve([])
			: database
					.select({ id: employeeDocument.id, title: employeeDocument.title })
					.from(employeeDocument)
					.where(and(inArray(employeeDocument.id, renewedIds), visibleDocumentsCondition(access))),
		creatorIds.length === 0
			? Promise.resolve([])
			: database
					.select({ id: user.id, name: user.name })
					.from(user)
					.where(inArray(user.id, creatorIds)),
	]);
	const renewedById = new Map(renewed.map((document) => [document.id, document]));
	const creatorNames = new Map(creators.map((creator) => [creator.id, creator.name]));
	const documentsBySubmission = new Map<
		string,
		DocumentRequestView["submissions"][number]["documents"]
	>();
	for (const document of linkedDocuments) {
		if (!document.submissionId) continue;
		const list = documentsBySubmission.get(document.submissionId) ?? [];
		list.push({
			id: document.id,
			title: document.title,
			fileName: document.fileName,
			mimeType: document.mimeType,
		});
		documentsBySubmission.set(document.submissionId, list);
	}
	return rows.map((row) => {
		const renewedDocument = row.renewedDocumentId ? renewedById.get(row.renewedDocumentId) : null;
		return {
			id: row.id,
			employeeId: row.employeeId,
			category: row.category,
			title: row.title,
			note: row.note,
			deadline: row.deadline,
			status: row.status,
			overdue: isDocumentRequestOverdue(row, today),
			version: row.version,
			renewedDocument: renewedDocument
				? { id: renewedDocument.id, title: renewedDocument.title }
				: null,
			createdByName: row.createdBy ? (creatorNames.get(row.createdBy) ?? null) : null,
			createdAt: row.createdAt.toISOString(),
			history: events
				.filter((event) => event.requestId === row.id)
				.map((event) => ({
					id: event.id,
					kind: event.kind,
					occurredAt: event.occurredAt.toISOString(),
					actorName: event.actorName ?? null,
					reason: event.reason,
					reasonCode: event.reasonCode,
					submissionId: event.submissionId,
					changes: event.changes,
				})),
			submissions: submissions
				.filter((submission) => submission.requestId === row.id)
				.map((submission) => ({
					id: submission.id,
					submittedAt: submission.submittedAt.toISOString(),
					note: submission.note,
					documents: documentsBySubmission.get(submission.id) ?? [],
				})),
		};
	});
}

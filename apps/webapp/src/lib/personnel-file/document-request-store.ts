import { and, asc, desc, eq, inArray, isNull, lt, or, type SQL, sql } from "drizzle-orm";
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
	team,
	teamMembership,
} from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import {
	canManageDocumentRequest,
	type EmployeeRef,
	isOwnDocument,
	managedCategoriesFor,
	managesCategory,
	managesDocumentRequests,
	type PersonnelFileAccess,
} from "./access";
import {
	loadEmployeeRef,
	loadEmployeeRefsInScope,
	managedDocumentRequestsCondition,
	managedEmployeesCondition,
	visibleDocumentsCondition,
} from "./access-store";
import {
	ACTIVE_DOCUMENT_REQUEST_STATUSES,
	DOCUMENT_REQUEST_BULK_MAX_RECIPIENTS,
	DOCUMENT_REQUEST_BULK_MAX_TEAMS,
	DOCUMENT_REQUEST_CATEGORIES,
	type DocumentRequestBulkSkipReason,
	type DocumentRequestDocumentView,
	type DocumentRequestEventChanges,
	type DocumentRequestEventKind,
	type DocumentRequestFollowUpEventKind,
	type DocumentRequestReasonCode,
	type DocumentRequestRefusal,
	type DocumentRequestStatus,
	type DocumentRequestView,
	isActiveDocumentRequestStatus,
} from "./document-request.types";
import type {
	DocumentRequestOverviewFilters,
	DocumentRequestRecipientOptions,
	ManagedDocumentRequestView,
} from "./document-request-overview";
import {
	isDocumentRequestOverdue,
	nextDocumentRequestStatus,
	optionalDocumentRequestText,
	validateDocumentRequestEdit,
	validateDocumentRequestInput,
	validateDocumentRequestReason,
} from "./document-request-rules";
import { lockDocument } from "./document-store";
import { loadOrganizationDay } from "./organization-day";
import {
	applyRenewalSkillLink,
	planRenewalSkillLink,
	type RenewalSkillLinkPlan,
} from "./renewal-skill-link";

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
	input: DocumentRequestAuditInput,
): Promise<void> {
	await tx.insert(auditLog).values(documentRequestAuditValues(input));
}

interface DocumentRequestAuditInput {
	kind: DocumentRequestEventKind;
	actorUserId: string;
	request: DocumentRequestRow;
	eventId: string;
	at: Date;
	metadata?: Record<string, unknown>;
}

function documentRequestAuditValues(
	input: DocumentRequestAuditInput,
): typeof auditLog.$inferInsert {
	const { request } = input;
	return {
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
	};
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
	// Narrow, so the departure's lifecycle client (no nested transactions) can use it.
	tx: Pick<Transaction, "insert" | "update">,
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

export type CreateDocumentRequestsInBulkResult =
	| {
			kind: "created";
			/** One per created request, with its `created` event (for the notifications). */
			created: Array<{ request: DocumentRequestRow; eventId: string }>;
			skippedBy: Record<DocumentRequestBulkSkipReason, number>;
	  }
	/** The actor covers no requestable category at all. */
	| { kind: "not_found" }
	| { kind: "refused"; reason: DocumentRequestRefusal };

/**
 * Creates the same request (category, title, note, deadline) for every
 * employee the named employees and teams reach (#1407), one request each, in
 * one transaction. Each employee is checked as for a single request: whoever
 * the actor does not cover for the category, the actor themself and former
 * employees are skipped, and so is anyone with an active request of the same
 * category and title. Bulk requests never name a renewed document. The
 * employees' request locks serialize concurrent bulk creates, so of two
 * identical batches only the first creates each request.
 */
export async function createDocumentRequestsInBulk(
	database: Database,
	access: PersonnelFileAccess,
	input: {
		employeeIds: readonly string[];
		teamIds: readonly string[];
		category: unknown;
		title: unknown;
		note: unknown;
		deadline: unknown;
	},
	now: Instant = systemClock.nowInstant(),
): Promise<CreateDocumentRequestsInBulkResult> {
	if (!managesDocumentRequests(access)) return { kind: "not_found" };
	const employeeIds = [...new Set(input.employeeIds)];
	const teamIds = [...new Set(input.teamIds)];
	if (employeeIds.length === 0 && teamIds.length === 0) {
		return { kind: "refused", reason: "no_recipients" };
	}
	if (
		employeeIds.length > DOCUMENT_REQUEST_BULK_MAX_RECIPIENTS ||
		teamIds.length > DOCUMENT_REQUEST_BULK_MAX_TEAMS
	) {
		return { kind: "refused", reason: "too_many_recipients" };
	}
	const at = dateFromInstant(now);
	const { organizationId } = access;
	const { today } = await loadOrganizationDay(database, { organizationId, now });
	const validated = validateDocumentRequestInput(input, today);
	if (!validated.ok) return { kind: "refused", reason: validated.reason };
	const value = validated.value;

	return database.transaction(async (tx): Promise<CreateDocumentRequestsInBulkResult> => {
		const skippedBy: Record<DocumentRequestBulkSkipReason, number> = {
			not_covered: 0,
			own_file: 0,
			former_employee: 0,
			already_requested: 0,
		};
		const reached = await loadEmployeeRefsInScope(tx, {
			organizationId,
			scope: { kind: "specific", employeeIds, teamIds },
			now,
		});
		const eligible: string[] = [];
		for (const employeeRef of reached) {
			if (isOwnDocument(access, employeeRef.id)) skippedBy.own_file += 1;
			else if (!canManageDocumentRequest(access, employeeRef, value.category)) {
				skippedBy.not_covered += 1;
			} else if (!employeeRef.hasAccess) skippedBy.former_employee += 1;
			else eligible.push(employeeRef.id);
		}
		if (eligible.length > DOCUMENT_REQUEST_BULK_MAX_RECIPIENTS) {
			return { kind: "refused", reason: "too_many_recipients" };
		}
		if (eligible.length === 0) return { kind: "created", created: [], skippedBy };

		await lockEmployeesDocumentRequests(tx, eligible);
		const duplicates = await tx
			.selectDistinct({ employeeId: employeeDocumentRequest.employeeId })
			.from(employeeDocumentRequest)
			.where(
				and(
					eq(employeeDocumentRequest.organizationId, organizationId),
					inArray(employeeDocumentRequest.employeeId, eligible),
					eq(employeeDocumentRequest.category, value.category),
					eq(employeeDocumentRequest.title, value.title),
					inArray(employeeDocumentRequest.status, [...ACTIVE_DOCUMENT_REQUEST_STATUSES]),
				),
			);
		const alreadyRequested = new Set(duplicates.map((row) => row.employeeId));
		skippedBy.already_requested = alreadyRequested.size;
		const recipients = eligible.filter((employeeId) => !alreadyRequested.has(employeeId));
		if (recipients.length === 0) return { kind: "created", created: [], skippedBy };

		const rows = await tx
			.insert(employeeDocumentRequest)
			.values(
				recipients.map((employeeId) => ({
					organizationId,
					employeeId,
					category: value.category,
					title: value.title,
					note: value.note,
					deadline: value.deadline,
					renewedDocumentId: null,
					status: "open" as const,
					version: 1,
					createdBy: access.userId,
					createdAt: at,
					updatedAt: at,
				})),
			)
			.returning();
		const events = await tx
			.insert(employeeDocumentRequestEvent)
			.values(
				rows.map((row) => ({
					organizationId,
					requestId: row.id,
					kind: "created" as const,
					actorUserId: access.userId,
					occurredAt: at,
				})),
			)
			.returning({
				id: employeeDocumentRequestEvent.id,
				requestId: employeeDocumentRequestEvent.requestId,
			});
		const eventOf = new Map(events.map((event) => [event.requestId, event.id]));
		const created = rows.map((request) => {
			const eventId = eventOf.get(request.id);
			if (!eventId) throw new Error("Failed to record the document request event");
			return { request, eventId };
		});
		await tx.insert(auditLog).values(
			created.map(({ request, eventId }) =>
				documentRequestAuditValues({
					kind: "created",
					actorUserId: access.userId,
					request,
					eventId,
					at,
					metadata: { bulk: true },
				}),
			),
		);
		return { kind: "created", created, skippedBy };
	});
}

/**
 * The employees and teams the bulk create offers (#1407), per requestable
 * category: the current employees (not former, never the viewer) whose
 * documents of the category the viewer manages, and the teams they belong to
 * (primary team or membership). The server re-checks every employee anyway.
 */
export async function listDocumentRequestRecipientOptions(
	database: Reader,
	access: PersonnelFileAccess,
	now: Instant = systemClock.nowInstant(),
): Promise<DocumentRequestRecipientOptions> {
	const { organizationId } = access;
	const entries = await Promise.all(
		DOCUMENT_REQUEST_CATEGORIES.map(async (category) => {
			if (!managesCategory(access, category)) {
				return [category, { employees: [], teams: [] }] as const;
			}
			const rows = await database
				.select({ id: employee.id, userName: user.name, employeeNumber: employee.employeeNumber })
				.from(employee)
				.leftJoin(user, eq(user.id, employee.userId))
				.where(
					and(
						eq(employee.organizationId, organizationId),
						managedEmployeesCondition(access, category, employee.id),
						employeeHasOrganizationAccess(now),
					),
				)
				.orderBy(asc(user.name), asc(employee.employeeNumber), asc(employee.id));
			const employeeIds = rows.map((row) => row.id);
			const teams =
				employeeIds.length === 0
					? []
					: await database
							.select({ id: team.id, name: team.name })
							.from(team)
							.where(
								and(
									eq(team.organizationId, organizationId),
									or(
										inArray(
											team.id,
											database
												.select({ teamId: employee.teamId })
												.from(employee)
												.where(
													and(
														eq(employee.organizationId, organizationId),
														inArray(employee.id, employeeIds),
													),
												),
										),
										inArray(
											team.id,
											database
												.select({ teamId: teamMembership.teamId })
												.from(teamMembership)
												.where(
													and(
														eq(teamMembership.organizationId, organizationId),
														inArray(teamMembership.employeeId, employeeIds),
													),
												),
										),
									),
								),
							)
							.orderBy(asc(team.name), asc(team.id));
			return [
				category,
				{
					employees: rows.map((row) => ({
						id: row.id,
						name: row.userName?.trim() || row.employeeNumber || row.id,
					})),
					teams,
				},
			] as const;
		}),
	);
	return Object.fromEntries(entries) as DocumentRequestRecipientOptions;
}

/**
 * Serializes request creation per employee for the rest of the transaction
 * (transaction-scoped advisory locks, taken in id order so two batches never
 * wait on each other crosswise).
 */
async function lockEmployeesDocumentRequests(
	tx: Transaction,
	employeeIds: readonly string[],
): Promise<void> {
	const keys = [...employeeIds].toSorted().map((id) => `employee_document_request:${id}`);
	await tx.execute(sql`
		select pg_advisory_xact_lock(hashtextextended(locked.key, 0))
		from (
			select key from unnest(array[${sql.join(
				keys.map((key) => sql`${key}`),
				sql`, `,
			)}]::text[]) as keys(key) order by key
		) as locked`);
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

/**
 * The departure's side of document requests (#1408): inside the departure
 * transaction, every open and submitted request of the departing employee is
 * cancelled with the system reason 'employment_ended', audited under the
 * departure's initiator and naming the departure. Nobody is notified. A rehire
 * never reopens them; documents already uploaded stay in the file under
 * retention. Returns the cancelled request ids.
 */
export async function cancelDocumentRequestsForDeparture(
	tx: Pick<Transaction, "select" | "insert" | "update">,
	input: {
		organizationId: string;
		employeeId: string;
		actorUserId: string;
		departureId: string;
		employmentPeriodId: string;
		now: Instant;
	},
): Promise<string[]> {
	const active = await tx
		.select()
		.from(employeeDocumentRequest)
		.where(
			and(
				eq(employeeDocumentRequest.organizationId, input.organizationId),
				eq(employeeDocumentRequest.employeeId, input.employeeId),
				inArray(employeeDocumentRequest.status, [...ACTIVE_DOCUMENT_REQUEST_STATUSES]),
			),
		)
		.orderBy(asc(employeeDocumentRequest.id))
		.for("update");
	const cancelled: string[] = [];
	// One event per request, in id order under the locks taken above.
	// react-doctor-disable-next-line react-doctor/async-await-in-loop
	for (const request of active) {
		const applied = await applyDocumentRequestEvent(tx, {
			request,
			event: {
				kind: "cancelled",
				actorUserId: input.actorUserId,
				reasonCode: "employment_ended",
				auditMetadata: {
					departureId: input.departureId,
					employmentPeriodId: input.employmentPeriodId,
				},
			},
			now: input.now,
		});
		// Locked and active above: only a bug gets here.
		if (applied.kind === "conflict") throw new Error("Document request moved on under its lock");
		cancelled.push(request.id);
	}
	return cancelled;
}

export type SubmitDocumentRequestResult =
	| { kind: "submitted"; request: DocumentRequestView; eventId: string; submissionId: string }
	/** Not the actor's own request, or not in the organization. */
	| { kind: "not_found" }
	/** The request is no longer open, or the employee's view is stale. */
	| { kind: "conflict" }
	| { kind: "refused"; reason: DocumentRequestRefusal };

/**
 * The employee hands in what they uploaded from their open request since the
 * last submission (#1402), with an optional note. The documents are in the
 * file already (ADR 0003); the request becomes `submitted`. Only the
 * request's own employee submits.
 */
export async function submitDocumentRequest(
	database: Database,
	access: PersonnelFileAccess,
	input: { requestId: string; note: unknown; expectedVersion?: number | null },
	now: Instant = systemClock.nowInstant(),
): Promise<SubmitDocumentRequestResult> {
	const note = optionalDocumentRequestText(input.note);
	if (!note.ok) return { kind: "refused", reason: note.reason };
	const at = dateFromInstant(now);
	const { today } = await loadOrganizationDay(database, {
		organizationId: access.organizationId,
		now,
	});
	return database.transaction(async (tx): Promise<SubmitDocumentRequestResult> => {
		const request = await lockDocumentRequest(tx, access.organizationId, input.requestId);
		if (!request || !isOwnDocument(access, request.employeeId)) return { kind: "not_found" };
		if (
			nextDocumentRequestStatus(request.status, "submitted") === null ||
			(input.expectedVersion != null && input.expectedVersion !== request.version)
		) {
			return { kind: "conflict" };
		}
		const pending = await tx
			.select({ documentId: employeeDocumentRequestDocument.documentId })
			.from(employeeDocumentRequestDocument)
			.where(
				and(
					eq(employeeDocumentRequestDocument.organizationId, access.organizationId),
					eq(employeeDocumentRequestDocument.requestId, request.id),
					isNull(employeeDocumentRequestDocument.submissionId),
				),
			)
			.orderBy(asc(employeeDocumentRequestDocument.createdAt))
			.for("update");
		if (pending.length === 0) return { kind: "refused", reason: "no_documents" };
		const documentIds = pending.map((row) => row.documentId);

		const [submission] = await tx
			.insert(employeeDocumentRequestSubmission)
			.values({
				organizationId: access.organizationId,
				requestId: request.id,
				note: note.value,
				submittedBy: access.userId,
				submittedAt: at,
			})
			.returning({ id: employeeDocumentRequestSubmission.id });
		if (!submission) throw new Error("Failed to record the submission");
		await tx
			.update(employeeDocumentRequestDocument)
			.set({ submissionId: submission.id })
			.where(
				and(
					eq(employeeDocumentRequestDocument.organizationId, access.organizationId),
					eq(employeeDocumentRequestDocument.requestId, request.id),
					inArray(employeeDocumentRequestDocument.documentId, documentIds),
				),
			);
		const applied = await applyDocumentRequestEvent(tx, {
			request,
			event: {
				kind: "submitted",
				actorUserId: access.userId,
				submissionId: submission.id,
				auditMetadata: {
					documentIds,
					...(note.value ? { submissionNote: note.value } : {}),
				},
			},
			expectedVersion: input.expectedVersion,
			now,
		});
		// Locked and checked above: only a bug gets here.
		if (applied.kind === "conflict") throw new Error("Document request moved on under its lock");
		const [view] = await toDocumentRequestViews(tx, access, [applied.request], today);
		if (!view) throw new Error("Failed to read the document request");
		return {
			kind: "submitted",
			request: view,
			eventId: applied.eventId,
			submissionId: submission.id,
		};
	});
}

export type DecideDocumentRequestResult<Kind extends "returned" | "accepted"> =
	| { kind: Kind; request: DocumentRequestView; eventId: string }
	| { kind: "not_found" }
	/** Not submitted (any more): another decision won, or the officer's view is stale. */
	| { kind: "conflict" }
	| { kind: "refused"; reason: DocumentRequestRefusal };

/**
 * An officer's decision on a submitted request, by whoever covers it now and
 * never on their own file. Of two concurrent decisions the first wins: the
 * second waits for the request's lock and then finds it decided (conflict).
 */
async function decideDocumentRequest<Kind extends "returned" | "accepted">(
	database: Database,
	access: PersonnelFileAccess,
	input: {
		requestId: string;
		kind: Kind;
		reason: string | null;
		expectedVersion?: number | null;
	},
	now: Instant,
): Promise<DecideDocumentRequestResult<Kind>> {
	const { today } = await loadOrganizationDay(database, {
		organizationId: access.organizationId,
		now,
	});
	return database.transaction(async (tx): Promise<DecideDocumentRequestResult<Kind>> => {
		const lookup = await lockManagedDocumentRequest(tx, access, input.requestId);
		if (lookup.kind !== "managed") return lookup;
		const { request } = lookup;
		// A decided request or a stale view conflicts before anything else is read.
		if (
			nextDocumentRequestStatus(request.status, input.kind) === null ||
			(input.expectedVersion != null && input.expectedVersion !== request.version)
		) {
			return { kind: "conflict" };
		}
		// Accepting a skill certificate renewal links its employee skill (#1405),
		// planned under the documents' locks before anything is written.
		const skillLink: RenewalSkillLinkPlan =
			input.kind === "accepted" ? await planRenewalSkillLink(tx, request) : { kind: "none" };
		if (skillLink.kind === "refused") return { kind: "refused", reason: skillLink.reason };
		const applied = await applyDocumentRequestEvent(tx, {
			request,
			event: {
				kind: input.kind,
				actorUserId: access.userId,
				reason: input.reason,
				...(skillLink.kind === "link"
					? {
							auditMetadata: {
								skillLink: {
									employeeSkillId: skillLink.employeeSkillId,
									documentIds: skillLink.documentIds,
								},
							},
						}
					: {}),
			},
			expectedVersion: input.expectedVersion,
			now,
		});
		if (applied.kind === "conflict") return { kind: "conflict" };
		if (skillLink.kind === "link") {
			await applyRenewalSkillLink(tx, access, skillLink, { requestId: request.id, now });
		}
		const [view] = await toDocumentRequestViews(tx, access, [applied.request], today);
		if (!view) throw new Error("Failed to read the document request");
		return { kind: input.kind, request: view, eventId: applied.eventId };
	});
}

/**
 * Returns a submitted request to the employee with a required reason (#1402):
 * it is open again, its documents stay in the file, and the next submission
 * adds new ones.
 */
export async function returnDocumentRequest(
	database: Database,
	access: PersonnelFileAccess,
	input: { requestId: string; reason: unknown; expectedVersion?: number | null },
	now: Instant = systemClock.nowInstant(),
): Promise<DecideDocumentRequestResult<"returned">> {
	const reason = validateDocumentRequestReason(input.reason);
	if (!reason.ok) return { kind: "refused", reason: reason.reason };
	return decideDocumentRequest(
		database,
		access,
		{
			requestId: input.requestId,
			kind: "returned",
			reason: reason.value,
			expectedVersion: input.expectedVersion,
		},
		now,
	);
}

/**
 * Accepts a submitted request (#1402). When its renewed document is a skill
 * certificate, the accepted submission's certificates are linked to the same
 * employee skill in the same transaction (#1405, `renewal-skill-link.ts`);
 * refused (`renewal_expiry_date_required`) when the skill requires an expiry
 * date and none of them has one.
 */
export async function acceptDocumentRequest(
	database: Database,
	access: PersonnelFileAccess,
	input: { requestId: string; expectedVersion?: number | null },
	now: Instant = systemClock.nowInstant(),
): Promise<DecideDocumentRequestResult<"accepted">> {
	return decideDocumentRequest(
		database,
		access,
		{
			requestId: input.requestId,
			kind: "accepted",
			reason: null,
			expectedVersion: input.expectedVersion,
		},
		now,
	);
}

export type EditDocumentRequestResult =
	/** `eventId` is null when nothing changed: then no history event is recorded. */
	| { kind: "edited"; request: DocumentRequestView; eventId: string | null }
	| { kind: "not_found" }
	| { kind: "conflict" }
	| { kind: "refused"; reason: DocumentRequestRefusal };

/**
 * Changes the deadline and note of an open or submitted request (#1403), by
 * whoever covers it now, never on their own file. Employee, category, title
 * and renewed document never change. Each edit is a history event and an
 * audit record with what changed; a new deadline re-arms the deadline
 * reminders (their ledger is keyed by the deadline, #1406). A closed request
 * or a stale `expectedVersion` conflicts.
 */
export async function editDocumentRequest(
	database: Database,
	access: PersonnelFileAccess,
	input: {
		requestId: string;
		deadline?: unknown;
		note?: unknown;
		expectedVersion?: number | null;
	},
	now: Instant = systemClock.nowInstant(),
): Promise<EditDocumentRequestResult> {
	const { today } = await loadOrganizationDay(database, {
		organizationId: access.organizationId,
		now,
	});
	return database.transaction(async (tx): Promise<EditDocumentRequestResult> => {
		const lookup = await lockManagedDocumentRequest(tx, access, input.requestId);
		if (lookup.kind !== "managed") return lookup;
		const { request } = lookup;
		if (
			!isActiveDocumentRequestStatus(request.status) ||
			(input.expectedVersion !== undefined &&
				input.expectedVersion !== null &&
				input.expectedVersion !== request.version)
		) {
			return { kind: "conflict" };
		}
		const validated = validateDocumentRequestEdit(request, input, today);
		if (!validated.ok) return { kind: "refused", reason: validated.reason };
		if (Object.keys(validated.value).length === 0) {
			const [view] = await toDocumentRequestViews(tx, access, [request], today);
			if (!view) throw new Error("Failed to read the document request");
			return { kind: "edited", request: view, eventId: null };
		}
		const applied = await applyDocumentRequestEvent(tx, {
			request,
			event: { kind: "edited", actorUserId: access.userId, patch: validated.value },
			expectedVersion: input.expectedVersion,
			now,
		});
		if (applied.kind === "conflict") return { kind: "conflict" };
		const [view] = await toDocumentRequestViews(tx, access, [applied.request], today);
		if (!view) throw new Error("Failed to read the document request");
		return { kind: "edited", request: view, eventId: applied.eventId };
	});
}

export type ManagedDocumentRequestsResult =
	/** The viewer covers no requestable category: the server refuses the list. */
	| { kind: "refused" }
	| {
			kind: "ok";
			rows: ManagedDocumentRequestView[];
			total: number;
			page: number;
			pageSize: number;
			pageCount: number;
	  };

function statusFilterCondition(filters: DocumentRequestOverviewFilters): SQL | undefined {
	switch (filters.status) {
		case "all":
			return undefined;
		case "active":
			return inArray(employeeDocumentRequest.status, [...ACTIVE_DOCUMENT_REQUEST_STATUSES]);
		default:
			return eq(employeeDocumentRequest.status, filters.status);
	}
}

const isActiveRequest = () => sql`${employeeDocumentRequest.status} in ('open', 'submitted')`;

/**
 * One page of the requests the viewer covers as an officer, across employees
 * (the "Document requests" page, #1403): the requestable categories each
 * grant covers, for the employees in its scope; everything for owners and
 * admins; never the viewer's own file (`managedDocumentRequestsCondition`).
 * Overdue is open and past the deadline in the organization's calendar.
 * Active requests come first, the nearest deadline first; closed ones follow,
 * most recently changed first. Former employees' requests stay listed.
 */
export async function listManagedDocumentRequests(
	database: Database,
	access: PersonnelFileAccess,
	filters: DocumentRequestOverviewFilters,
	now: Instant = systemClock.nowInstant(),
): Promise<ManagedDocumentRequestsResult> {
	if (!managesDocumentRequests(access)) return { kind: "refused" };
	const { organizationId } = access;
	const { today } = await loadOrganizationDay(database, { organizationId, now });
	const where = and(
		managedDocumentRequestsCondition(access),
		statusFilterCondition(filters),
		filters.overdue
			? and(
					eq(employeeDocumentRequest.status, "open"),
					lt(employeeDocumentRequest.deadline, today.toString()),
				)
			: undefined,
	) as SQL;
	const ofEmployee = and(
		eq(employee.id, employeeDocumentRequest.employeeId),
		eq(employee.organizationId, organizationId),
	);

	const [countRow] = await database
		.select({ total: sql<number>`count(*)::int` })
		.from(employeeDocumentRequest)
		.innerJoin(employee, ofEmployee)
		.where(where);
	const total = countRow?.total ?? 0;
	const pageCount = Math.max(1, Math.ceil(total / filters.pageSize));
	const page = Math.min(filters.page, pageCount);
	const rows = await database
		.select({
			request: employeeDocumentRequest,
			userName: user.name,
			employeeNumber: employee.employeeNumber,
			isActive: employee.isActive,
		})
		.from(employeeDocumentRequest)
		.innerJoin(employee, ofEmployee)
		.leftJoin(user, eq(user.id, employee.userId))
		.where(where)
		.orderBy(
			sql`case when ${isActiveRequest()} then 0 else 1 end`,
			sql`case when ${isActiveRequest()} then ${employeeDocumentRequest.deadline} end asc`,
			desc(employeeDocumentRequest.updatedAt),
			asc(employeeDocumentRequest.id),
		)
		.limit(filters.pageSize)
		.offset((page - 1) * filters.pageSize);

	const views = await toDocumentRequestViews(
		database,
		access,
		rows.map((row) => row.request),
		today,
	);
	return {
		kind: "ok",
		rows: views.map((view, index) => {
			const row = rows[index];
			return {
				...view,
				employeeName: row?.userName?.trim() || row?.employeeNumber || view.employeeId,
				employeeNumber: row?.employeeNumber ?? null,
				isFormer: row ? !row.isActive : false,
			};
		}),
		total,
		page,
		pageSize: filters.pageSize,
		pageCount,
	};
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
				requestId: employeeDocumentRequestDocument.requestId,
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
	const documentsBySubmission = new Map<string, DocumentRequestDocumentView[]>();
	// Uploaded from a request, not handed in yet (#1402), by request.
	const pendingByRequest = new Map<string, DocumentRequestDocumentView[]>();
	for (const document of linkedDocuments) {
		const groups = document.submissionId ? documentsBySubmission : pendingByRequest;
		const key = document.submissionId ?? document.requestId;
		const list = groups.get(key) ?? [];
		list.push({
			id: document.id,
			title: document.title,
			fileName: document.fileName,
			mimeType: document.mimeType,
		});
		groups.set(key, list);
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
			pendingDocuments: pendingByRequest.get(row.id) ?? [],
		};
	});
}

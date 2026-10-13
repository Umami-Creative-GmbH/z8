/**
 * Audit log category of a personal data export (#811, #1171): the audit
 * entries of this organization about the employee, and what the employee did.
 *
 * - **`entries`**: rows about the employee (`employee_id` is them, the
 *   audited entity is their employee record, or it is one of their own
 *   records: time entries, work periods, absences, requests, period
 *   submissions, expense reports and claims), with who acted, the change and
 *   its context. Another actor's IP address, user agent and email never go in;
 *   stored-object references inside the JSON are removed.
 * - **`actions_on_others`**: everything the employee did that is not about
 *   their own records (audit rows on colleagues' records or on the
 *   organization, plus actions on colleagues the audit log does not record:
 *   time entries created for them, work-policy violations acknowledged,
 *   vacation adjustments made). Like approval decisions on others
 *   (`redaction.ts`): kind, action, time and an opaque id for the colleague,
 *   never their name, record ids, reasons or the change itself.
 *
 * The employee export holds an entry only when its action is on an explicit
 * allowlist and passes its per-row check, so audit rows never leak withheld
 * data (HR-only documents, billable and cost rates, custom fields above
 * employee visibility, departure tasks and reviews, travel-expense project
 * exception reasons). The admin export holds every entry about the employee.
 *
 * `employee_id` is not always the subject: approval chain events, escalation
 * transfers, expense report returns and reopens, and organization settings
 * store the actor's employee id there (`ACTOR_IN_EMPLOYEE_ID_ACTIONS`). A row the
 * employee performed is therefore attributed to the owner of the audited
 * record (where it has one) before it counts as being about them.
 */

import { and, asc, eq, inArray, isNotNull, ne, or, type SQLWrapper } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import {
	absenceEntry,
	approvalRequest,
	auditLog,
	customFieldDefinition,
	employee,
	employeeDocument,
	periodSubmission,
	timeEntry,
	travelExpenseClaim,
	travelExpenseReport,
	vacationAdjustment,
	workPeriod,
	workPolicyViolation,
} from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { PERSONNEL_FILE_AUDIT_ENTITY_TYPE } from "@/lib/personnel-file/audit";
import { isUuid } from "@/lib/validations/uuid";
import {
	type CollectedCategory,
	type PersonalDataCollector,
	type PersonalDataExportDatabase,
	type PersonalDataExportScope,
	type PersonalDataRow,
	tablePart,
} from "../collector";
import {
	ACTION_ON_OTHERS_COLUMNS,
	type ActionOnOther,
	actionOnOtherRow,
	otherPeopleOf,
} from "../redaction";
import { withoutStorageReferences } from "../storage-references";
import { instantText, loadUserNames, nameOf } from "../values";
import { auditLogFieldGuide } from "./audit-log-fields";

const ENTRY_COLUMNS = [
	"timestamp",
	"action",
	"entity_type",
	"entity_id",
	"performed_by",
	"performed_by_you",
	"ip_address",
	"user_agent",
	"changes",
	"metadata",
] as const;

/** Entity types whose `entity_id` is an employee id (the person the row is about). */
const PERSON_ENTITY_TYPES = new Set(["employee", "permission", "schedule", "vacation"]);

/**
 * Actions an employee export may show in full when the row is about the
 * employee. Anything else (new actions included) stays in the admin export
 * until it is reviewed and added here.
 */
const EMPLOYEE_EXPORT_ACTIONS: ReadonlySet<string> = new Set<string>([
	AuditAction.MANAGER_ASSIGNED,
	AuditAction.MANAGER_REMOVED,
	AuditAction.MANAGER_PRIMARY_CHANGED,
	AuditAction.PERMISSION_GRANTED,
	AuditAction.PERMISSION_REVOKED,
	AuditAction.SCHEDULE_CREATED,
	AuditAction.SCHEDULE_UPDATED,
	AuditAction.TEAM_MEMBER_ADDED,
	AuditAction.TEAM_MEMBER_REMOVED,
	AuditAction.EMPLOYEE_CREATED,
	AuditAction.EMPLOYEE_UPDATED,
	AuditAction.EMPLOYEE_DEACTIVATED,
	AuditAction.EMPLOYEE_REACTIVATED,
	AuditAction.INVITATION_SENT,
	AuditAction.INVITATION_ACCEPTED,
	AuditAction.TIME_ENTRY_CREATED,
	AuditAction.TIME_ENTRY_CORRECTED,
	AuditAction.TIME_ENTRY_CHAIN_VERIFIED,
	AuditAction.ABSENCE_REQUESTED,
	AuditAction.ABSENCE_APPROVED,
	AuditAction.ABSENCE_REJECTED,
	AuditAction.ABSENCE_CANCELLED,
	AuditAction.ABSENCE_SICK_DETAIL_CHANGED,
	AuditAction.ABSENCE_DEPUTY_CHANGED,
	AuditAction.BALANCE_ADJUSTMENT_RECORDED,
	AuditAction.BALANCE_ADJUSTMENT_CANCELLED,
	AuditAction.APPROVAL_SUBMITTED,
	AuditAction.APPROVAL_APPROVED,
	AuditAction.APPROVAL_REJECTED,
	AuditAction.TRAVEL_EXPENSE_DRAFT_CREATED,
	AuditAction.TRAVEL_EXPENSE_DRAFT_DELETED,
	AuditAction.TRAVEL_EXPENSE_SUBMITTED,
	AuditAction.TRAVEL_EXPENSE_CONVERSION_RECORDED,
	AuditAction.TRAVEL_EXPENSE_CONVERSION_REMOVED,
	AuditAction.TRAVEL_EXPENSE_REIMBURSEMENT_CURRENCY_UPDATED,
	AuditAction.TRAVEL_EXPENSE_RETURNED,
	AuditAction.TRAVEL_EXPENSE_WITHDRAWN,
	AuditAction.TRAVEL_EXPENSE_REOPENED,
	AuditAction.TRAVEL_EXPENSE_REIMBURSEMENT_RECORDED,
	AuditAction.TRAVEL_EXPENSE_ADJUSTMENT_CREATED,
	AuditAction.TRAVEL_EXPENSE_LEGACY_DRAFT_CONVERTED,
	AuditAction.TRAVEL_EXPENSE_RECOVERY_RECORDED,
	AuditAction.TRAVEL_EXPENSE_ALLOWANCE_OVERRIDE_AUTHORIZED,
	AuditAction.TRAVEL_EXPENSE_ALLOWANCE_OVERRIDE_REVOKED,
	AuditAction.TRAVEL_EXPENSE_PAYROLL_RUN_REPORT_REMOVED,
	AuditAction.TRAVEL_EXPENSE_PAYROLL_RUN_REPORT_CONFIRMED,
	AuditAction.VACATION_CARRYOVER_APPLIED,
	AuditAction.VACATION_CARRYOVER_EXPIRED,
	AuditAction.VACATION_ALLOWANCE_UPDATED,
	AuditAction.LOGIN_SUCCESS,
	AuditAction.LOGIN_FAILED,
	AuditAction.LOGOUT,
	AuditAction.PASSWORD_CHANGED,
	AuditAction.TWO_FACTOR_ENABLED,
	AuditAction.TWO_FACTOR_DISABLED,
	AuditAction.POSITION_CAPTURE_ASSIGNMENT_SET,
	AuditAction.POSITION_CAPTURE_ASSIGNMENT_REMOVED,
	// Personnel file documents: only those the employee sees (see `isEmployeeVisible`).
	AuditAction.PERSONNEL_FILE_DOCUMENT_UPLOADED,
	AuditAction.PERSONNEL_FILE_DOCUMENT_UPDATED,
	AuditAction.PERSONNEL_FILE_DOCUMENT_DELETED,
	AuditAction.PERSONNEL_FILE_DOCUMENT_VIEWED,
	AuditAction.PERSONNEL_FILE_DOCUMENT_DOWNLOADED,
	AuditAction.PERSONNEL_FILE_DOCUMENT_PURGED,
	AuditAction.PERSONNEL_FILE_SICK_NOTE_LINKED,
	AuditAction.PERSONNEL_FILE_SICK_NOTE_UNLINKED,
	AuditAction.CLOSED_MONTH_CLOSED,
	AuditAction.CLOSED_MONTH_REOPENED,
	AuditAction.PERIOD_SUBMISSION_SUBMITTED,
	AuditAction.PERIOD_SUBMISSION_APPROVED,
	AuditAction.PERIOD_SUBMISSION_STAGE_APPROVED,
	AuditAction.PERIOD_SUBMISSION_REJECTED,
	AuditAction.PERIOD_SUBMISSION_WITHDRAWN,
	AuditAction.PERIOD_SUBMISSION_OUTDATED,
	AuditAction.ICS_FEED_CREATED,
	AuditAction.ICS_FEED_REGENERATED,
	AuditAction.ICS_FEED_REVOKED,
	AuditAction.PERSONAL_DATA_EXPORT_REQUESTED,
	AuditAction.PERSONAL_DATA_EXPORT_DOWNLOADED,
	AuditAction.APP_ACCESS_GRANTED,
	AuditAction.APP_ACCESS_REVOKED,
	AuditAction.APP_ACCESS_DENIED,
	AuditAction.SURCHARGE_CALCULATION_CREATED,
	AuditAction.SURCHARGE_CALCULATION_RECALCULATED,
	AuditAction.WORK_PERIOD_PROJECT_ASSIGNED,
	AuditAction.WORK_PERIOD_PROJECT_UNASSIGNED,
	// Custom field values: only fields the employee sees (see `isEmployeeVisible`).
	AuditAction.CUSTOM_FIELD_VALUE_SET,
	AuditAction.CUSTOM_FIELD_VALUE_CHANGED,
	AuditAction.CUSTOM_FIELD_VALUE_CLEARED,
	AuditAction.CUSTOM_FIELD_VALUE_HISTORY_ADDED,
	AuditAction.CUSTOM_FIELD_VALUE_HISTORY_CORRECTED,
	AuditAction.CUSTOM_FIELD_VALUE_HISTORY_DELETED,
	AuditAction.LOCATION_EMPLOYEE_ASSIGNED,
	AuditAction.LOCATION_EMPLOYEE_REMOVED,
	AuditAction.SUBAREA_EMPLOYEE_ASSIGNED,
	AuditAction.SUBAREA_EMPLOYEE_REMOVED,
	AuditAction.ASSIGNED_LOCATION_ADDED,
	AuditAction.ASSIGNED_LOCATION_REMOVED,
	AuditAction.KIOSK_PIN_ISSUED,
	AuditAction.KIOSK_PIN_RESET,
	AuditAction.KIOSK_PIN_UNLOCKED,
	AuditAction.KIOSK_PIN_CHANGED,
	AuditAction.KIOSK_ONLY_EMPLOYEE_CREATED,
	AuditAction.KIOSK_ONLY_EMPLOYEE_EMAIL_ADDED,
]);

/** Older writers record a generic verb; allowed per entity type (`entity_type:action`). */
const EMPLOYEE_EXPORT_LEGACY_ACTIONS: ReadonlySet<string> = new Set([
	"work_period:update",
	"shift_request:cancel",
]);

const CUSTOM_FIELD_VALUE_ACTIONS: ReadonlySet<string> = new Set([
	AuditAction.CUSTOM_FIELD_VALUE_SET,
	AuditAction.CUSTOM_FIELD_VALUE_CHANGED,
	AuditAction.CUSTOM_FIELD_VALUE_CLEARED,
	AuditAction.CUSTOM_FIELD_VALUE_HISTORY_ADDED,
	AuditAction.CUSTOM_FIELD_VALUE_HISTORY_CORRECTED,
	AuditAction.CUSTOM_FIELD_VALUE_HISTORY_DELETED,
]);

type AuditRow = typeof auditLog.$inferSelect;

/** What the employee export needs to know beyond the row itself. */
interface EmployeeVisibility {
	/** Custom field definitions of the organization the employee sees. */
	visibleFieldIds: ReadonlySet<string>;
	/** Personnel file documents the employee sees (current or, once gone, last known). */
	sharedDocumentIds: ReadonlySet<string>;
}

/** Whether an entry about the employee may go into the employee export. */
function isEmployeeVisible(row: AuditRow, visibility: EmployeeVisibility): boolean {
	const allowed =
		EMPLOYEE_EXPORT_ACTIONS.has(row.action) ||
		EMPLOYEE_EXPORT_LEGACY_ACTIONS.has(`${row.entityType}:${row.action}`);
	if (!allowed) return false;
	if (row.entityType === PERSONNEL_FILE_AUDIT_ENTITY_TYPE) {
		return visibility.sharedDocumentIds.has(row.entityId);
	}
	if (CUSTOM_FIELD_VALUE_ACTIONS.has(row.action)) {
		const fieldId = parseJson(row.metadata)?.fieldId;
		return typeof fieldId === "string" && visibility.visibleFieldIds.has(fieldId);
	}
	return true;
}

export const auditLogCollector: PersonalDataCollector = {
	category: "audit_log",
	collect: collectAuditLog,
	fields: auditLogFieldGuide,
};

async function collectAuditLog(
	database: PersonalDataExportDatabase,
	scope: PersonalDataExportScope,
): Promise<CollectedCategory> {
	const { organizationId, employeeId, userId } = scope;
	const rows = await database
		.select()
		.from(auditLog)
		.where(
			and(
				eq(auditLog.organizationId, organizationId),
				or(
					eq(auditLog.performedBy, userId),
					eq(auditLog.employeeId, employeeId),
					and(
						inArray(auditLog.entityType, [...PERSON_ENTITY_TYPES]),
						eq(auditLog.entityId, employeeId),
					),
					// Rows on the employee's own records that do not name them in employee_id.
					...ownedRecordSources(database, organizationId).map(({ types, ownedBy }) =>
						and(
							inArray(auditLog.entityType, types),
							inArray(auditLog.entityId, ownedBy(employeeId)),
						),
					),
				),
			),
		)
		.orderBy(asc(auditLog.timestamp), asc(auditLog.id));

	const byEmployee = rows.filter((row) => row.performedBy === userId);
	const owners = await loadRecordOwners(database, organizationId, byEmployee);

	const about: AuditRow[] = [];
	const actions: Array<ActionOnOther & { at: number }> = [];
	for (const row of rows) {
		if (row.performedBy !== userId) {
			// Someone else's action: it matched by being about the employee.
			about.push(row);
			continue;
		}
		const subject = subjectOf(row, employeeId, owners);
		if (subject.kind === "employee") {
			about.push(row);
			continue;
		}
		actions.push({
			recordKind: row.entityType,
			authority: "audit_log",
			action: row.action,
			actedAt: row.timestamp,
			asDeputy: false,
			otherEmployeeId: subject.kind === "other" ? subject.employeeId : null,
			at: row.timestamp.getTime(),
		});
	}
	actions.push(...(await recordActionsOnOthers(database, scope)));

	const visibility =
		scope.kind === "admin" ? null : await loadEmployeeVisibility(database, scope, about);
	const visibleAbout = visibility
		? about.filter((row) => isEmployeeVisible(row, visibility))
		: about;
	// The employee export never shows that a document they cannot see exists.
	const withheldDocument = (documentId: string) =>
		visibility !== null && !visibility.sharedDocumentIds.has(documentId);

	const names = await loadUserNames(
		database,
		visibleAbout.map((row) => row.performedBy),
	);
	const people = otherPeopleOf(scope);
	return {
		category: "audit_log",
		parts: [
			tablePart(
				"entries",
				ENTRY_COLUMNS,
				visibleAbout.map((row) => entryRow(row, userId, names, withheldDocument)),
			),
			tablePart(
				"actions_on_others",
				ACTION_ON_OTHERS_COLUMNS,
				actions
					.map((action, index) => ({ action, index }))
					.sort((a, b) => a.action.at - b.action.at || a.index - b.index)
					.map(({ action: { at: _at, ...action } }) => actionOnOtherRow(people, action)),
			),
		],
	};
}

function entryRow(
	row: AuditRow,
	userId: string,
	names: Map<string, string>,
	withheldDocument: (documentId: string) => boolean,
): PersonalDataRow {
	const own = row.performedBy === userId;
	return {
		timestamp: instantText(row.timestamp),
		action: row.action,
		entity_type: row.entityType,
		entity_id: row.entityId,
		performed_by: nameOf(names, row.performedBy),
		performed_by_you: own,
		ip_address: own ? row.ipAddress : null,
		user_agent: own ? row.userAgent : null,
		changes: exportedJson(row.changes, own, withheldDocument),
		metadata: exportedJson(row.metadata, own, withheldDocument),
	};
}

/**
 * A JSON text column as exported: stored-object references removed; on
 * another actor's row, their email (`actorEmail`, written by `logAudit`); and
 * a `documentId` naming a document the export withholds (an HR-only sick note).
 */
function exportedJson(
	text: string | null,
	own: boolean,
	withheldDocument: (documentId: string) => boolean,
): string | null {
	if (text === null) return null;
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return text;
	}
	if (value !== null && typeof value === "object" && !Array.isArray(value)) {
		value = Object.fromEntries(
			Object.entries(value).filter(
				([key, field]) =>
					!(key === "actorEmail" && !own) &&
					!(key === "documentId" && typeof field === "string" && withheldDocument(field)),
			),
		);
	}
	return JSON.stringify(withoutStorageReferences(value));
}

function parseJson(text: string | null): Record<string, unknown> | null {
	if (!text) return null;
	try {
		const value: unknown = JSON.parse(text);
		return value !== null && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

/**
 * Actions whose writers store the acting employee, not the subject, in
 * `employee_id`: reviewers acting on a colleague's expense report, and admins
 * changing organization-wide settings or sharing reports.
 */
const ACTOR_IN_EMPLOYEE_ID_ACTIONS: ReadonlySet<string> = new Set<string>([
	AuditAction.APPROVAL_ESCALATION_TRANSFERRED,
	AuditAction.TRAVEL_EXPENSE_RETURNED,
	AuditAction.TRAVEL_EXPENSE_REOPENED,
	AuditAction.TRAVEL_EXPENSE_ALLOWANCE_OVERRIDE_AUTHORIZED,
	AuditAction.TRAVEL_EXPENSE_ALLOWANCE_OVERRIDE_REVOKED,
	AuditAction.TRAVEL_EXPENSE_REIMBURSEMENT_CURRENCY_UPDATED,
	AuditAction.TRAVEL_EXPENSE_POLICY_VERSION_ACTIVATED,
	AuditAction.TRAVEL_EXPENSE_POLICY_VERSION_WITHDRAWN,
	AuditAction.TRAVEL_EXPENSE_REFERENCE_RATE_APPROVED,
	AuditAction.TRAVEL_EXPENSE_REFERENCE_RATE_REVOKED,
	AuditAction.REPORT_SHARE_LINK_CREATED,
]);

/** Writers that store the acting employee, not the subject, in `employee_id`. */
function employeeIdIsActor(row: AuditRow): boolean {
	return (
		ACTOR_IN_EMPLOYEE_ID_ACTIONS.has(row.action) ||
		row.action.startsWith("approval_chain.") ||
		row.action.startsWith("approval_policy.")
	);
}

type RowSubject =
	| { kind: "employee" }
	| { kind: "other"; employeeId: string }
	/** Not about a person, e.g. an organization setting or a project. */
	| { kind: "none" };

/** Whom a row the employee performed is about. */
function subjectOf(
	row: AuditRow,
	employeeId: string,
	owners: ReadonlyMap<string, string>,
): RowSubject {
	const person = (id: string): RowSubject =>
		id === employeeId ? { kind: "employee" } : { kind: "other", employeeId: id };
	// The audited record's owner decides first.
	const owner = owners.get(recordKey(row.entityType, row.entityId));
	if (owner !== undefined) return person(owner);
	if (PERSON_ENTITY_TYPES.has(row.entityType)) return person(row.entityId);
	if (row.employeeId && !employeeIdIsActor(row)) return person(row.employeeId);
	const named = parseJson(row.metadata)?.employeeId;
	if (typeof named === "string" && named !== employeeId) return person(named);
	return { kind: "none" };
}

function recordKey(entityType: string, entityId: string): string {
	return `${entityType}:${entityId}`;
}

interface OwnedRecordSource {
	/** Audit entity types whose `entity_id` is a record of this table. */
	types: readonly string[];
	/** The ids of the employee's own records, as a subquery. */
	ownedBy(employeeId: string): SQLWrapper;
	/** The owner employee of each of the given records. */
	owners(ids: string[]): Promise<Array<{ id: string; owner: string | null }>>;
}

/**
 * The records an audit row can name, with their owner employee. Every table
 * is read within the organization; `absence_entry.organization_id` is
 * nullable, so absences are scoped through their employee.
 */
function ownedRecordSources(
	database: PersonalDataExportDatabase,
	organizationId: string,
): OwnedRecordSource[] {
	const inOrganization = (
		types: readonly string[],
		table: PgTable,
		columns: { id: AnyPgColumn; owner: AnyPgColumn; organizationId: AnyPgColumn },
	): OwnedRecordSource => ({
		types,
		ownedBy: (employeeId) =>
			database
				.select({ id: columns.id })
				.from(table)
				.where(and(eq(columns.organizationId, organizationId), eq(columns.owner, employeeId))),
		owners: async (ids) =>
			(await database
				.select({ id: columns.id, owner: columns.owner })
				.from(table)
				.where(
					and(eq(columns.organizationId, organizationId), inArray(columns.id, ids)),
				)) as Array<{
				id: string;
				owner: string | null;
			}>,
	});
	const absenceInOrganization = and(
		eq(employee.id, absenceEntry.employeeId),
		eq(employee.organizationId, organizationId),
	);
	return [
		{
			types: ["absence_entry", "absence"],
			ownedBy: (employeeId) =>
				database
					.select({ id: absenceEntry.id })
					.from(absenceEntry)
					.innerJoin(employee, absenceInOrganization)
					.where(eq(absenceEntry.employeeId, employeeId)),
			owners: (ids) =>
				database
					.select({ id: absenceEntry.id, owner: absenceEntry.employeeId })
					.from(absenceEntry)
					.innerJoin(employee, absenceInOrganization)
					.where(inArray(absenceEntry.id, ids)),
		},
		inOrganization(["time_entry"], timeEntry, {
			id: timeEntry.id,
			owner: timeEntry.employeeId,
			organizationId: timeEntry.organizationId,
		}),
		inOrganization(["work_period"], workPeriod, {
			id: workPeriod.id,
			owner: workPeriod.employeeId,
			organizationId: workPeriod.organizationId,
		}),
		inOrganization(["approval_request"], approvalRequest, {
			id: approvalRequest.id,
			owner: approvalRequest.requestedBy,
			organizationId: approvalRequest.organizationId,
		}),
		inOrganization(["period_submission"], periodSubmission, {
			id: periodSubmission.id,
			owner: periodSubmission.employeeId,
			organizationId: periodSubmission.organizationId,
		}),
		// Expense writers audit reports and claims as entity type "approval".
		inOrganization(["travel_expense_report", "approval"], travelExpenseReport, {
			id: travelExpenseReport.id,
			owner: travelExpenseReport.employeeId,
			organizationId: travelExpenseReport.organizationId,
		}),
		inOrganization(["travel_expense_claim", "approval"], travelExpenseClaim, {
			id: travelExpenseClaim.id,
			owner: travelExpenseClaim.employeeId,
			organizationId: travelExpenseClaim.organizationId,
		}),
	];
}

/** Owner employee ids of the records the employee's audit rows name, by `entity_type:entity_id`. */
async function loadRecordOwners(
	database: PersonalDataExportDatabase,
	organizationId: string,
	rows: readonly AuditRow[],
): Promise<Map<string, string>> {
	const owners = new Map<string, string>();
	for (const source of ownedRecordSources(database, organizationId)) {
		const ids = [
			...new Set(
				rows.filter((row) => source.types.includes(row.entityType)).map((row) => row.entityId),
			),
		];
		if (ids.length === 0) continue;
		for (const { id, owner } of await source.owners(ids)) {
			if (owner) for (const type of source.types) owners.set(recordKey(type, id), owner);
		}
	}
	return owners;
}

/**
 * Actions on colleagues the audit log does not record: time entries the
 * employee created for them, work-policy violations they acknowledged and
 * vacation adjustments they made.
 */
async function recordActionsOnOthers(
	database: PersonalDataExportDatabase,
	scope: PersonalDataExportScope,
): Promise<Array<ActionOnOther & { at: number }>> {
	const { organizationId, employeeId, userId } = scope;
	const [entries, violations, adjustments] = await Promise.all([
		database
			.select({ owner: timeEntry.employeeId, at: timeEntry.createdAt })
			.from(timeEntry)
			.where(
				and(
					eq(timeEntry.organizationId, organizationId),
					eq(timeEntry.createdBy, userId),
					ne(timeEntry.employeeId, employeeId),
				),
			),
		database
			.select({ owner: workPolicyViolation.employeeId, at: workPolicyViolation.acknowledgedAt })
			.from(workPolicyViolation)
			.where(
				and(
					eq(workPolicyViolation.organizationId, organizationId),
					eq(workPolicyViolation.acknowledgedBy, employeeId),
					ne(workPolicyViolation.employeeId, employeeId),
				),
			),
		// vacation_adjustment has no organization column: scope through the employee.
		database
			.select({ owner: vacationAdjustment.employeeId, at: vacationAdjustment.createdAt })
			.from(vacationAdjustment)
			.innerJoin(
				employee,
				and(
					eq(employee.id, vacationAdjustment.employeeId),
					eq(employee.organizationId, organizationId),
				),
			)
			.where(
				and(
					isNotNull(vacationAdjustment.adjustedBy),
					eq(vacationAdjustment.adjustedBy, employeeId),
					ne(vacationAdjustment.employeeId, employeeId),
				),
			),
	]);
	const action = (
		recordKind: string,
		verb: string,
		row: { owner: string; at: Date | null },
	): ActionOnOther & { at: number } => ({
		recordKind,
		authority: "record",
		action: verb,
		actedAt: row.at,
		asDeputy: false,
		otherEmployeeId: row.owner,
		at: row.at?.getTime() ?? 0,
	});
	return [
		...entries.map((row) => action("time_entry", "created", row)),
		...violations.map((row) => action("work_policy_violation", "acknowledged", row)),
		...adjustments.map((row) => action("vacation_adjustment", "adjusted", row)),
	];
}

/** The custom fields and documents the employee sees, for the entries that name them. */
async function loadEmployeeVisibility(
	database: PersonalDataExportDatabase,
	scope: PersonalDataExportScope,
	rows: readonly AuditRow[],
): Promise<EmployeeVisibility> {
	const { organizationId, employeeId } = scope;
	const fields = await database
		.select({ id: customFieldDefinition.id })
		.from(customFieldDefinition)
		.where(
			and(
				eq(customFieldDefinition.organizationId, organizationId),
				eq(customFieldDefinition.visibility, "employee"),
			),
		);

	const documentRows = rows.filter((row) => row.entityType === PERSONNEL_FILE_AUDIT_ENTITY_TYPE);
	// Other rows can name a document too, e.g. the sick note linked to an absence.
	const referencedIds = rows.flatMap((row) =>
		[parseJson(row.metadata)?.documentId, parseJson(row.changes)?.documentId].filter(
			(id): id is string => isUuid(id),
		),
	);
	const documentIds = [...new Set([...documentRows.map((row) => row.entityId), ...referencedIds])];
	const current =
		documentIds.length === 0
			? []
			: await database
					.select({ id: employeeDocument.id, visibility: employeeDocument.visibility })
					.from(employeeDocument)
					.where(
						and(
							eq(employeeDocument.organizationId, organizationId),
							eq(employeeDocument.employeeId, employeeId),
							inArray(employeeDocument.id, documentIds),
						),
					);
	// A document that is gone counts with the last visibility its audit rows recorded.
	const visibilityById = new Map<string, string>();
	for (const row of documentRows) {
		const recorded = parseJson(row.metadata)?.document;
		const visibility =
			recorded !== null && typeof recorded === "object"
				? (recorded as Record<string, unknown>).visibility
				: undefined;
		if (typeof visibility === "string") visibilityById.set(row.entityId, visibility);
	}
	for (const document of current) visibilityById.set(document.id, document.visibility);

	return {
		visibleFieldIds: new Set(fields.map((field) => field.id)),
		sharedDocumentIds: new Set(
			[...visibilityById].filter(([, visibility]) => visibility === "shared").map(([id]) => id),
		),
	};
}

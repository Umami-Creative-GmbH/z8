/**
 * Audit log category of a personal data export (#811, #1171): the audit
 * entries of this organization about the employee, and what the employee did.
 *
 * - **`entries`**: rows about the employee (`employee_id` is them, or the
 *   audited entity is their employee record), with who acted, the change and
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
 * `employee_id` is not always the subject: approval chain events and
 * escalation transfers store the actor's employee id there. A row the
 * employee performed is therefore attributed to the owner of the audited
 * record (where it has one) before it counts as being about them.
 */

import { and, asc, eq, inArray, isNotNull, ne, or } from "drizzle-orm";
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

	const visibleAbout =
		scope.kind === "admin"
			? about
			: await (async () => {
					const visibility = await loadEmployeeVisibility(database, scope, about);
					return about.filter((row) => isEmployeeVisible(row, visibility));
				})();

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
				visibleAbout.map((row) => entryRow(row, userId, names)),
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

function entryRow(row: AuditRow, userId: string, names: Map<string, string>): PersonalDataRow {
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
		changes: exportedJson(row.changes, own),
		metadata: exportedJson(row.metadata, own),
	};
}

/**
 * A JSON text column as exported: stored-object references removed and, on
 * another actor's row, their email (`actorEmail`, written by `logAudit`).
 */
function exportedJson(text: string | null, own: boolean): string | null {
	if (text === null) return null;
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return text;
	}
	if (!own && value !== null && typeof value === "object" && !Array.isArray(value)) {
		const { actorEmail: _actorEmail, ...rest } = value as Record<string, unknown>;
		value = rest;
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

/** Writers that store the acting employee, not the subject, in `employee_id`. */
function employeeIdIsActor(row: AuditRow): boolean {
	return (
		row.action === AuditAction.APPROVAL_ESCALATION_TRANSFERRED ||
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

/** Owner employee ids of the records the employee's audit rows name, by `entity_type:entity_id`. */
async function loadRecordOwners(
	database: PersonalDataExportDatabase,
	organizationId: string,
	rows: readonly AuditRow[],
): Promise<Map<string, string>> {
	const idsOf = (...types: string[]) => [
		...new Set(rows.filter((row) => types.includes(row.entityType)).map((row) => row.entityId)),
	];
	const owners = new Map<string, string>();
	const add = (types: string[], found: Array<{ id: string; owner: string | null }>) => {
		for (const { id, owner } of found) {
			if (owner) for (const type of types) owners.set(recordKey(type, id), owner);
		}
	};

	const absenceIds = idsOf("absence_entry", "absence");
	if (absenceIds.length > 0) {
		add(
			["absence_entry", "absence"],
			await database
				.select({ id: absenceEntry.id, owner: absenceEntry.employeeId })
				.from(absenceEntry)
				.innerJoin(
					employee,
					and(
						eq(employee.id, absenceEntry.employeeId),
						eq(employee.organizationId, organizationId),
					),
				)
				.where(inArray(absenceEntry.id, absenceIds)),
		);
	}
	const entryIds = idsOf("time_entry");
	if (entryIds.length > 0) {
		add(
			["time_entry"],
			await database
				.select({ id: timeEntry.id, owner: timeEntry.employeeId })
				.from(timeEntry)
				.where(and(eq(timeEntry.organizationId, organizationId), inArray(timeEntry.id, entryIds))),
		);
	}
	const periodIds = idsOf("work_period");
	if (periodIds.length > 0) {
		add(
			["work_period"],
			await database
				.select({ id: workPeriod.id, owner: workPeriod.employeeId })
				.from(workPeriod)
				.where(
					and(eq(workPeriod.organizationId, organizationId), inArray(workPeriod.id, periodIds)),
				),
		);
	}
	const requestIds = idsOf("approval_request");
	if (requestIds.length > 0) {
		add(
			["approval_request"],
			await database
				.select({ id: approvalRequest.id, owner: approvalRequest.requestedBy })
				.from(approvalRequest)
				.where(
					and(
						eq(approvalRequest.organizationId, organizationId),
						inArray(approvalRequest.id, requestIds),
					),
				),
		);
	}
	const submissionIds = idsOf("period_submission");
	if (submissionIds.length > 0) {
		add(
			["period_submission"],
			await database
				.select({ id: periodSubmission.id, owner: periodSubmission.employeeId })
				.from(periodSubmission)
				.where(
					and(
						eq(periodSubmission.organizationId, organizationId),
						inArray(periodSubmission.id, submissionIds),
					),
				),
		);
	}
	const reportIds = idsOf("travel_expense_report");
	if (reportIds.length > 0) {
		add(
			["travel_expense_report"],
			await database
				.select({ id: travelExpenseReport.id, owner: travelExpenseReport.employeeId })
				.from(travelExpenseReport)
				.where(
					and(
						eq(travelExpenseReport.organizationId, organizationId),
						inArray(travelExpenseReport.id, reportIds),
					),
				),
		);
	}
	const claimIds = idsOf("travel_expense_claim");
	if (claimIds.length > 0) {
		add(
			["travel_expense_claim"],
			await database
				.select({ id: travelExpenseClaim.id, owner: travelExpenseClaim.employeeId })
				.from(travelExpenseClaim)
				.where(
					and(
						eq(travelExpenseClaim.organizationId, organizationId),
						inArray(travelExpenseClaim.id, claimIds),
					),
				),
		);
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
	const documentIds = [...new Set(documentRows.map((row) => row.entityId))];
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

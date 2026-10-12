import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { db } from "@/db";
import { member } from "@/db/auth-schema";
import { auditLog, customFieldValue, customRole, employee, employeeCustomRole } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { isUuid } from "@/lib/billable-time/input";
import { type PlainDate, plainDateAt, systemClock } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import type { CustomFieldEntity, CustomFieldType } from "./definition-rules";
import {
	type CustomFieldDefinitionView,
	type CustomFieldReader,
	listActiveCustomFields,
	listCustomFieldDefinitions,
} from "./definitions";
import {
	applyCustomFieldHistoryChanges,
	type CustomFieldHistoryEffect,
	type CustomFieldHistoryEntry,
	customFieldValueAsOf,
	newestFirst,
} from "./history-rules";
import { lockCustomFieldValueWrites } from "./lock";
import {
	type CustomFieldValuesRefusal,
	englishDefaults,
	namedValueRefusalMessage,
} from "./refusal-messages";
import {
	type CustomFieldValue,
	canonicalStoredDecimal,
	missingRequiredCustomFieldIds,
	parseCustomFieldValueInput,
	sameCustomFieldValue,
} from "./value-rules";
import {
	type CustomFieldViewerLevel,
	canEditCustomField,
	canViewCustomField,
	resolveCustomFieldViewerLevel,
} from "./viewer-level";

type Database = typeof db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything that can write inside a transaction: a transaction of the app database. */
export type CustomFieldWriter = Pick<
	Transaction,
	"select" | "insert" | "update" | "delete" | "execute"
>;

type ValueRow = typeof customFieldValue.$inferSelect;

// ---------------------------------------------------------------------------
// Viewer level
// ---------------------------------------------------------------------------

/**
 * The custom field level of a user in an organization (spec #769 decision D1):
 * see `resolveCustomFieldViewerLevel`. Null = no access.
 */
export async function loadCustomFieldViewerLevel(
	reader: CustomFieldReader,
	input: { organizationId: string; userId: string },
): Promise<CustomFieldViewerLevel | null> {
	const [membership] = await reader
		.select({ role: member.role })
		.from(member)
		.where(
			and(
				eq(member.organizationId, input.organizationId),
				eq(member.userId, input.userId),
				eq(member.status, "approved"),
			),
		)
		.limit(1);
	if (!membership) return null;

	const [employeeRow] = await reader
		// Past a due departure's cutoff counts as inactive, like everywhere else.
		.select({ id: employee.id, role: employee.role, isActive: employeeHasOrganizationAccess() })
		.from(employee)
		.where(
			and(eq(employee.organizationId, input.organizationId), eq(employee.userId, input.userId)),
		)
		.limit(1);
	const baseTiers = employeeRow
		? await reader
				.select({ baseTier: customRole.baseTier })
				.from(employeeCustomRole)
				.innerJoin(customRole, eq(customRole.id, employeeCustomRole.customRoleId))
				.where(
					and(
						eq(employeeCustomRole.employeeId, employeeRow.id),
						eq(customRole.organizationId, input.organizationId),
						eq(customRole.isActive, true),
					),
				)
		: [];

	return resolveCustomFieldViewerLevel({
		membershipRole: membership.role,
		employee: employeeRow ? { role: employeeRow.role, isActive: employeeRow.isActive } : null,
		customRoleBaseTiers: baseTiers.map((row) => row.baseTier),
	});
}

/** Today in the organization's timezone: the as-of date of forms and missing required values. */
export async function customFieldsToday(
	reader: CustomFieldReader,
	organizationId: string,
): Promise<PlainDate> {
	const timezone = await loadOrganizationTimezone(reader, organizationId);
	return plainDateAt(systemClock.nowInstant(), timezone);
}

// ---------------------------------------------------------------------------
// As-of read contract
// ---------------------------------------------------------------------------

/**
 * Whose eyes a read uses:
 * - `system`: every field, ignoring visibility (payroll identifier mapping, jobs);
 * - `actor`: the user's custom field level in the organization (loaded here);
 * - `level`: an already resolved level (null = no access, sees nothing).
 *
 * Which records the viewer may reach is the caller's job: pass only reachable
 * `recordIds`. The level never widens reach.
 */
export type CustomFieldViewer =
	| { kind: "system" }
	| { kind: "actor"; userId: string }
	| { kind: "level"; level: CustomFieldViewerLevel | null };

export interface CustomFieldValuesAsOf {
	/** The fields the viewer sees, active ones in their order (then archived ones when asked for). */
	fields: CustomFieldDefinitionView[];
	/**
	 * Values as of the date, by record id then field id. A record or field without
	 * a value is absent. Only fields in `fields`, only records of the organization.
	 */
	values: Record<string, Record<string, CustomFieldValue>>;
	/**
	 * Active required fields in `fields` without a value as of the date, by record
	 * id, in field order. Records without a missing value are absent.
	 */
	missingRequired: Record<string, string[]>;
}

/** The value row column naming the record, by record kind. */
const RECORD_KEY = {
	employee: "employeeId",
	project: "projectId",
	customer: "customerId",
} as const satisfies Record<CustomFieldEntity, keyof ValueRow>;

const recordColumn = (entity: CustomFieldEntity) => customFieldValue[RECORD_KEY[entity]];

const recordIdOf = (row: ValueRow, entity: CustomFieldEntity): string | null =>
	row[RECORD_KEY[entity]];

/** The record columns of a new value row: the record's own set, the others null. */
function recordColumns(scope: Pick<CustomFieldWriteScope, "entity" | "recordId">) {
	const columns: Record<(typeof RECORD_KEY)[CustomFieldEntity], string | null> = {
		employeeId: null,
		projectId: null,
		customerId: null,
	};
	columns[RECORD_KEY[scope.entity]] = scope.recordId;
	return columns;
}

/** One value row of the organization, by id. */
const valueRow = (scope: Pick<CustomFieldWriteScope, "organizationId">, id: string) =>
	and(eq(customFieldValue.organizationId, scope.organizationId), eq(customFieldValue.id, id));

function storedValue(row: ValueRow, type: CustomFieldType): CustomFieldValue | null {
	switch (type) {
		case "text":
			return row.textValue === null ? null : { type, value: row.textValue };
		case "number":
			return row.numberValue === null
				? null
				: { type, value: canonicalStoredDecimal(row.numberValue) };
		case "date":
			return row.dateValue === null ? null : { type, value: row.dateValue };
		case "boolean":
			return row.booleanValue === null ? null : { type, value: row.booleanValue };
		case "select":
			return row.selectOptionId === null ? null : { type, value: row.selectOptionId };
	}
}

/** A tracked field's dated row as a history entry (null for an undated row). */
function historyEntryOf(row: ValueRow, type: CustomFieldType): CustomFieldHistoryEntry | null {
	const value = storedValue(row, type);
	return row.validFrom === null || value === null
		? null
		: { id: row.id, validFrom: row.validFrom, value };
}

async function levelOf(
	reader: CustomFieldReader,
	organizationId: string,
	viewer: CustomFieldViewer,
): Promise<CustomFieldViewerLevel | null | "system"> {
	switch (viewer.kind) {
		case "system":
			return "system";
		case "level":
			return viewer.level;
		case "actor":
			return loadCustomFieldViewerLevel(reader, { organizationId, userId: viewer.userId });
	}
}

/**
 * The custom field values of some records of one kind, as of a date, as one
 * viewer sees them (#818; tracked values #819, reports #820, payroll #821).
 *
 * Every query is organization scoped: record ids of another organization
 * simply have no values. Values of fields the viewer can't see never leave
 * this function. A tracked field's value is the one with the latest valid-from
 * on or before `asOf` (none before its first valid-from date); an untracked
 * field's single value applies whatever the date (#819).
 */
export async function readCustomFieldValues(
	reader: CustomFieldReader,
	input: {
		organizationId: string;
		entity: CustomFieldEntity;
		recordIds: readonly string[];
		asOf: PlainDate;
		viewer: CustomFieldViewer;
		/** Also return archived fields (and their values) the viewer sees. Default false. */
		includeArchivedFields?: boolean;
	},
): Promise<CustomFieldValuesAsOf> {
	const level = await levelOf(reader, input.organizationId, input.viewer);
	if (level === null) return { fields: [], values: {}, missingRequired: {} };

	const definitions = input.includeArchivedFields
		? (await listCustomFieldDefinitions(reader, input.organizationId)).filter(
				(field) => field.entity === input.entity,
			)
		: await listActiveCustomFields(reader, input.organizationId, input.entity);
	const fields =
		level === "system"
			? definitions
			: definitions.filter((field) => canViewCustomField(level, field.visibility));

	const recordIds = [...new Set(input.recordIds)].filter(isUuid);
	const values: Record<string, Record<string, CustomFieldValue>> = {};
	if (fields.length > 0 && recordIds.length > 0) {
		const rows = await reader
			.select()
			.from(customFieldValue)
			.where(
				and(
					eq(customFieldValue.organizationId, input.organizationId),
					inArray(recordColumn(input.entity), recordIds),
					inArray(
						customFieldValue.definitionId,
						fields.map((field) => field.id),
					),
					or(
						isNull(customFieldValue.validFrom),
						lte(customFieldValue.validFrom, input.asOf.toString()),
					),
				),
			);
		const fieldById = new Map(fields.map((field) => [field.id, field]));
		const byRecordField = new Map<string, { recordId: string; rows: ValueRow[] }>();
		for (const row of rows) {
			const recordId = recordIdOf(row, input.entity);
			if (!recordId) continue;
			const key = `${recordId}:${row.definitionId}`;
			const group = byRecordField.get(key) ?? { recordId, rows: [] };
			group.rows.push(row);
			byRecordField.set(key, group);
		}
		for (const { recordId, rows: group } of byRecordField.values()) {
			const field = fieldById.get(group[0].definitionId);
			if (!field) continue;
			const value = field.tracked
				? customFieldValueAsOf(
						group.flatMap((row) => historyEntryOf(row, field.type) ?? []),
						input.asOf,
					)
				: storedValue(group.find((row) => row.validFrom === null) ?? group[0], field.type);
			if (!value) continue;
			values[recordId] ??= {};
			values[recordId][field.id] = value;
		}
	}

	const required = fields.filter((field) => !field.archived);
	const missingRequired: Record<string, string[]> = {};
	for (const recordId of recordIds) {
		const missing = missingRequiredCustomFieldIds(required, values[recordId] ?? {});
		if (missing.length > 0) missingRequired[recordId] = missing;
	}
	return { fields, values, missingRequired };
}

/** A field of a record's custom fields section, with whether the viewer may change it. */
export interface CustomFieldSectionField extends CustomFieldDefinitionView {
	editable: boolean;
}

/** What the "Custom fields" section of one record (or a record being created) shows. */
export interface CustomFieldSection {
	/** The active fields the viewer sees, in order. */
	fields: CustomFieldSectionField[];
	/** The record's values today, by field id (only fields in `fields`). */
	values: Record<string, CustomFieldValue>;
	/** Required fields in `fields` without a value today (the "missing required values" indicator). */
	missingRequiredFieldIds: string[];
	/**
	 * The dated history of each tracked field in `fields`, newest first (#819).
	 * A tracked field without entries is absent.
	 */
	history: Record<string, CustomFieldHistoryEntry[]>;
	/** Today in the organization's timezone ("YYYY-MM-DD"), the date `values` are read as of. */
	today: string;
}

/**
 * The custom fields section of one record as a viewer at `level` sees it,
 * today in the organization's timezone. `recordId` null = a record being
 * created (fields only). The caller checks that the viewer reaches the record.
 */
export async function readCustomFieldSection(
	reader: CustomFieldReader,
	input: {
		organizationId: string;
		entity: CustomFieldEntity;
		recordId: string | null;
		level: CustomFieldViewerLevel | null;
	},
): Promise<CustomFieldSection> {
	const today = await customFieldsToday(reader, input.organizationId);
	const read = await readCustomFieldValues(reader, {
		organizationId: input.organizationId,
		entity: input.entity,
		recordIds: input.recordId ? [input.recordId] : [],
		asOf: today,
		viewer: { kind: "level", level: input.level },
	});
	const tracked = read.fields.filter((field) => field.tracked);
	return {
		fields: read.fields.map((field) => ({
			...field,
			editable: canEditCustomField(input.level, field.editLevel),
		})),
		values: input.recordId ? (read.values[input.recordId] ?? {}) : {},
		missingRequiredFieldIds: input.recordId ? (read.missingRequired[input.recordId] ?? []) : [],
		history:
			input.recordId && tracked.length > 0
				? await readHistory(reader, {
						organizationId: input.organizationId,
						entity: input.entity,
						recordId: input.recordId,
						fields: tracked,
					})
				: {},
		today: today.toString(),
	};
}

/** The dated history of some tracked fields of one record, newest first, by field id. */
async function readHistory(
	reader: CustomFieldReader,
	input: {
		organizationId: string;
		entity: CustomFieldEntity;
		recordId: string;
		fields: readonly CustomFieldDefinitionView[];
	},
): Promise<Record<string, CustomFieldHistoryEntry[]>> {
	if (!isUuid(input.recordId)) return {};
	const rows = await reader
		.select()
		.from(customFieldValue)
		.where(
			and(
				eq(customFieldValue.organizationId, input.organizationId),
				eq(recordColumn(input.entity), input.recordId),
				inArray(
					customFieldValue.definitionId,
					input.fields.map((field) => field.id),
				),
				isNotNull(customFieldValue.validFrom),
			),
		);
	const typeOf = new Map(input.fields.map((field) => [field.id, field.type]));
	const history: Record<string, CustomFieldHistoryEntry[]> = {};
	for (const row of rows) {
		const type = typeOf.get(row.definitionId);
		const entry = type ? historyEntryOf(row, type) : null;
		if (!entry) continue;
		history[row.definitionId] = [...(history[row.definitionId] ?? []), entry];
	}
	for (const fieldId of Object.keys(history)) history[fieldId] = newestFirst(history[fieldId]);
	return history;
}

/**
 * The records among `recordIds` with a missing required value today, among
 * the fields `viewer` sees (the list markers). The caller passes reachable
 * records only.
 */
export async function findRecordsMissingRequiredValues(
	reader: CustomFieldReader,
	input: {
		organizationId: string;
		entity: CustomFieldEntity;
		recordIds: readonly string[];
		viewer: CustomFieldViewer;
	},
): Promise<Set<string>> {
	if (input.recordIds.length === 0) return new Set();
	const read = await readCustomFieldValues(reader, {
		...input,
		asOf: await customFieldsToday(reader, input.organizationId),
	});
	return new Set(Object.keys(read.missingRequired));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type { CustomFieldValuesRefusal } from "./refusal-messages";

/**
 * A refused custom field value write. The message is the English default, for
 * logs; save actions show `namedValueRefusalMessage` in the user's language.
 */
export class CustomFieldValuesRefused extends Error {
	constructor(
		readonly reason: CustomFieldValuesRefusal,
		readonly fieldId: string,
		readonly fieldName: string | null,
	) {
		super(namedValueRefusalMessage(englishDefaults, reason, fieldName));
		this.name = "CustomFieldValuesRefused";
	}
}

/** Whose values are written, by whom: one record of one organization. */
export interface CustomFieldWriteScope {
	organizationId: string;
	actorUserId: string;
	entity: CustomFieldEntity;
	recordId: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function columnsOf(value: CustomFieldValue | null) {
	return {
		textValue: value?.type === "text" ? value.value : null,
		numberValue: value?.type === "number" ? value.value : null,
		dateValue: value?.type === "date" ? value.value : null,
		booleanValue: value?.type === "boolean" ? value.value : null,
		selectOptionId: value?.type === "select" ? value.value : null,
	};
}

function auditValue(field: CustomFieldDefinitionView, value: CustomFieldValue | null) {
	if (value === null) return null;
	if (value.type === "select") {
		const option = field.options.find((candidate) => candidate.id === value.value);
		return { optionId: value.value, label: option?.label ?? null };
	}
	return value.value;
}

/**
 * Applies a form's custom field values to one employee, project or customer
 * (#818). Runs inside the caller's transaction, after the caller resolved the
 * record and checked the writer reaches it; a refusal throws
 * `CustomFieldValuesRefused` so the caller's whole save rolls back.
 *
 * - `values`: field id -> input (see `CustomFieldValueInput`). Fields left out
 *   keep their value; unchanged values are not written.
 * - A tracked field (#819) takes dated changes instead of a value:
 *   `{ history: CustomFieldHistoryChange[] }` adds entries with any valid-from
 *   date, corrects or deletes existing ones (`applyCustomFieldHistoryChanges`).
 *   A plain value for it is refused (`tracked_field`).
 * - Every listed field must be an active field of this record kind that the
 *   writer's `level` may edit, and the input must pass the field's type rules.
 * - `requireComplete` (form saves only): afterwards, every active required
 *   field the writer may edit must have a value, tracked ones as of today.
 *   Provisioning paths (SCIM, invitations, SSO, invite codes, demo data) don't
 *   call this at all.
 * - Every change writes an audit entry on the record naming the field and the
 *   old and new value (for tracked fields: with the valid-from dates).
 */
export async function writeCustomFieldValues(
	tx: CustomFieldWriter,
	input: CustomFieldWriteScope & {
		level: CustomFieldViewerLevel | null;
		values: unknown;
		requireComplete: boolean;
		/** The date required tracked fields are checked as of. Default: today in the organization's timezone. */
		today?: PlainDate;
	},
): Promise<void> {
	if (input.values !== undefined && input.values !== null && !isRecord(input.values)) {
		throw new CustomFieldValuesRefused("invalid_value", "", null);
	}
	const requested = Object.entries(input.values ?? {});
	if (requested.length === 0 && !input.requireComplete) return;

	// Shared with other value writes, exclusive with definition changes (archiving a
	// field or option): the definitions read below are the ones in force at commit.
	await lockCustomFieldValueWrites(tx, input.organizationId);
	await tx.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${`custom_field_values:${input.recordId}`}, 0))`,
	);
	const fields = (await listCustomFieldDefinitions(tx, input.organizationId)).filter(
		(field) => field.entity === input.entity,
	);
	const fieldById = new Map(fields.map((field) => [field.id, field]));
	const rows = await tx
		.select()
		.from(customFieldValue)
		.where(
			and(
				eq(customFieldValue.organizationId, input.organizationId),
				eq(recordColumn(input.entity), input.recordId),
			),
		);
	const rowByField = new Map(
		rows.filter((row) => row.validFrom === null).map((row) => [row.definitionId, row]),
	);
	const rowById = new Map(rows.map((row) => [row.id, row]));
	const historyOf = (field: CustomFieldDefinitionView) =>
		rows.flatMap((row) =>
			row.definitionId === field.id ? (historyEntryOf(row, field.type) ?? []) : [],
		);
	const current = (field: CustomFieldDefinitionView) => {
		const row = rowByField.get(field.id);
		return row ? storedValue(row, field.type) : null;
	};
	/** Untracked: the value; tracked: the history entries (read as of today below). */
	const finalUntracked: Record<string, CustomFieldValue | null> = {};
	const finalHistory: Record<
		string,
		readonly Pick<CustomFieldHistoryEntry, "validFrom" | "value">[]
	> = {};
	for (const field of fields) {
		if (field.tracked) finalHistory[field.id] = historyOf(field);
		else finalUntracked[field.id] = current(field);
	}

	for (const [fieldId, raw] of requested) {
		const field = fieldById.get(fieldId);
		if (!field) throw new CustomFieldValuesRefused("unknown_field", fieldId, null);
		if (!canEditCustomField(input.level, field.editLevel)) {
			throw new CustomFieldValuesRefused("not_editable", fieldId, field.name);
		}
		if (field.archived) throw new CustomFieldValuesRefused("field_archived", fieldId, field.name);
		if (field.tracked) {
			if (!isRecord(raw)) throw new CustomFieldValuesRefused("tracked_field", fieldId, field.name);
			const applied = applyCustomFieldHistoryChanges(field, historyOf(field), raw);
			if (!applied.ok) throw new CustomFieldValuesRefused(applied.reason, fieldId, field.name);
			finalHistory[fieldId] = applied.entries;
			await writeHistory(tx, input, field, applied.effects, rowById);
			continue;
		}
		const before = current(field);
		const parsed = parseCustomFieldValueInput(field, raw, before);
		if (!parsed.ok) throw new CustomFieldValuesRefused(parsed.reason, fieldId, field.name);
		finalUntracked[fieldId] = parsed.value;
		if (sameCustomFieldValue(before, parsed.value)) continue;
		await writeOne(tx, input, field, rowByField.get(fieldId) ?? null, before, parsed.value);
	}

	if (input.requireComplete) {
		const editableRequired = fields.filter(
			(field) => !field.archived && canEditCustomField(input.level, field.editLevel),
		);
		const finalValues: Record<string, CustomFieldValue | null> = { ...finalUntracked };
		if (editableRequired.some((field) => field.tracked && field.required)) {
			const today = input.today ?? (await customFieldsToday(tx, input.organizationId));
			for (const [fieldId, entries] of Object.entries(finalHistory)) {
				finalValues[fieldId] = customFieldValueAsOf(entries, today);
			}
		}
		const [missing] = missingRequiredCustomFieldIds(editableRequired, finalValues);
		if (missing) {
			throw new CustomFieldValuesRefused(
				"missing_required",
				missing,
				fieldById.get(missing)?.name ?? null,
			);
		}
	}
}

async function writeOne(
	tx: CustomFieldWriter,
	scope: CustomFieldWriteScope,
	field: CustomFieldDefinitionView,
	row: ValueRow | null,
	before: CustomFieldValue | null,
	after: CustomFieldValue | null,
) {
	if (after === null) {
		if (row) await tx.delete(customFieldValue).where(valueRow(scope, row.id));
	} else if (row) {
		await tx
			.update(customFieldValue)
			.set({ ...columnsOf(after), updatedAt: sql`now()`, updatedBy: scope.actorUserId })
			.where(valueRow(scope, row.id));
	} else {
		await tx.insert(customFieldValue).values({
			organizationId: scope.organizationId,
			definitionId: field.id,
			...recordColumns(scope),
			...columnsOf(after),
			tracked: false,
			createdBy: scope.actorUserId,
			updatedBy: scope.actorUserId,
		});
	}

	await tx.insert(auditLog).values({
		organizationId: scope.organizationId,
		entityType: scope.entity,
		entityId: scope.recordId,
		action:
			before === null
				? AuditAction.CUSTOM_FIELD_VALUE_SET
				: after === null
					? AuditAction.CUSTOM_FIELD_VALUE_CLEARED
					: AuditAction.CUSTOM_FIELD_VALUE_CHANGED,
		performedBy: scope.actorUserId,
		changes: JSON.stringify({ before: auditValue(field, before), after: auditValue(field, after) }),
		metadata: JSON.stringify({
			fieldId: field.id,
			fieldName: field.name,
			fieldType: field.type,
			entity: scope.entity,
		}),
	});
}

function auditEntry(
	field: CustomFieldDefinitionView,
	entry: Pick<CustomFieldHistoryEntry, "validFrom" | "value"> | null,
) {
	return entry ? { validFrom: entry.validFrom, value: auditValue(field, entry.value) } : null;
}

/**
 * Writes a tracked field's history changes (#819) and audits each one. Rows
 * leaving their date (deletions, and corrections that move the date) go
 * first, then in-place value corrections, then rows at their new dates, so the
 * per-date uniqueness never trips over an intermediate state. A moved entry
 * keeps its id and creation stamp.
 */
async function writeHistory(
	tx: CustomFieldWriter,
	scope: CustomFieldWriteScope,
	field: CustomFieldDefinitionView,
	effects: readonly CustomFieldHistoryEffect[],
	rowById: ReadonlyMap<string, ValueRow>,
) {
	const steps = effects.map((effect) => {
		const before = effect.kind === "added" ? null : effect.before;
		const after = effect.kind === "deleted" ? null : effect.after;
		return {
			kind: effect.kind,
			entryId: before?.id ?? randomUUID(),
			before,
			after,
			moves: before !== null && after !== null && before.validFrom !== after.validFrom,
		};
	});

	for (const step of steps) {
		if (step.before && (step.after === null || step.moves)) {
			await tx.delete(customFieldValue).where(valueRow(scope, step.entryId));
		}
	}
	for (const step of steps) {
		if (step.before && step.after && !step.moves) {
			await tx
				.update(customFieldValue)
				.set({
					...columnsOf(step.after.value),
					updatedAt: sql`now()`,
					updatedBy: scope.actorUserId,
				})
				.where(valueRow(scope, step.entryId));
		}
	}
	for (const step of steps) {
		if (!step.after || (step.before && !step.moves)) continue;
		const original = step.before ? rowById.get(step.entryId) : undefined;
		await tx.insert(customFieldValue).values({
			id: step.entryId,
			organizationId: scope.organizationId,
			definitionId: field.id,
			...recordColumns(scope),
			...columnsOf(step.after.value),
			validFrom: step.after.validFrom,
			tracked: true,
			...(original ? { createdAt: original.createdAt } : {}),
			createdBy: original ? original.createdBy : scope.actorUserId,
			updatedBy: scope.actorUserId,
		});
	}

	for (const step of steps) {
		await tx.insert(auditLog).values({
			organizationId: scope.organizationId,
			entityType: scope.entity,
			entityId: scope.recordId,
			action: HISTORY_AUDIT_ACTIONS[step.kind],
			performedBy: scope.actorUserId,
			changes: JSON.stringify({
				before: auditEntry(field, step.before),
				after: auditEntry(field, step.after),
			}),
			metadata: JSON.stringify({
				fieldId: field.id,
				fieldName: field.name,
				fieldType: field.type,
				entity: scope.entity,
				entryId: step.entryId,
			}),
		});
	}
}

const HISTORY_AUDIT_ACTIONS = {
	added: AuditAction.CUSTOM_FIELD_VALUE_HISTORY_ADDED,
	corrected: AuditAction.CUSTOM_FIELD_VALUE_HISTORY_CORRECTED,
	deleted: AuditAction.CUSTOM_FIELD_VALUE_HISTORY_DELETED,
} as const;

import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { db } from "@/db";
import { member } from "@/db/auth-schema";
import { auditLog, customFieldValue, customRole, employee, employeeCustomRole } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { type PlainDate, plainDateAt, systemClock } from "@/lib/datetime/temporal-core";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import type { CustomFieldEntity, CustomFieldType } from "./definition-rules";
import {
	type CustomFieldDefinitionView,
	type CustomFieldReader,
	listActiveCustomFields,
	listCustomFieldDefinitions,
} from "./definitions";
import {
	type CustomFieldValue,
	type CustomFieldValueRefusal,
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
		.select({ id: employee.id, role: employee.role, isActive: employee.isActive })
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

const RECORD_COLUMN = {
	employee: customFieldValue.employeeId,
	project: customFieldValue.projectId,
	customer: customFieldValue.customerId,
} as const;

function recordIdOf(row: ValueRow, entity: CustomFieldEntity): string | null {
	switch (entity) {
		case "employee":
			return row.employeeId;
		case "project":
			return row.projectId;
		case "customer":
			return row.customerId;
	}
}

function storedValue(row: ValueRow, type: CustomFieldType): CustomFieldValue | null {
	switch (type) {
		case "text":
			return row.textValue === null ? null : { type, value: row.textValue };
		case "number":
			return row.numberValue === null ? null : { type, value: canonicalNumeric(row.numberValue) };
		case "date":
			return row.dateValue === null ? null : { type, value: row.dateValue };
		case "boolean":
			return row.booleanValue === null ? null : { type, value: row.booleanValue };
		case "select":
			return row.selectOptionId === null ? null : { type, value: row.selectOptionId };
	}
}

/** PostgreSQL returns numerics as stored; strip trailing fractional zeros. */
function canonicalNumeric(value: string): string {
	const canonical = value.includes(".") ? value.replace(/\.?0+$/, "") : value;
	return canonical === "-0" ? "0" : canonical;
}

/**
 * Whether `row` is the value as of `asOf`: dated rows count from their
 * valid-from date; an undated row counts always and loses to any dated row
 * that applies. (Untracked fields only have undated rows; #819 adds dated ones.)
 */
function appliesAsOf(row: ValueRow, asOf: string): boolean {
	return row.validFrom === null || row.validFrom <= asOf;
}

function newer(candidate: ValueRow, current: ValueRow | undefined): boolean {
	if (!current) return true;
	if (candidate.validFrom === current.validFrom) return false;
	if (current.validFrom === null) return true;
	return candidate.validFrom !== null && candidate.validFrom > current.validFrom;
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
 * this function. In #818 the as-of date doesn't change the result yet, since
 * there are no dated values.
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

	const recordIds = [...new Set(input.recordIds)].filter((id) => UUID.test(id));
	const values: Record<string, Record<string, CustomFieldValue>> = {};
	if (fields.length > 0 && recordIds.length > 0) {
		const rows = await reader
			.select()
			.from(customFieldValue)
			.where(
				and(
					eq(customFieldValue.organizationId, input.organizationId),
					inArray(RECORD_COLUMN[input.entity], recordIds),
					inArray(
						customFieldValue.definitionId,
						fields.map((field) => field.id),
					),
				),
			);
		const asOf = input.asOf.toString();
		const latest = new Map<string, ValueRow>();
		for (const row of rows) {
			if (!appliesAsOf(row, asOf)) continue;
			const key = `${recordIdOf(row, input.entity)}:${row.definitionId}`;
			if (newer(row, latest.get(key))) latest.set(key, row);
		}
		const typeOf = new Map(fields.map((field) => [field.id, field.type]));
		for (const row of latest.values()) {
			const recordId = recordIdOf(row, input.entity);
			const type = typeOf.get(row.definitionId);
			const value = type ? storedValue(row, type) : null;
			if (!recordId || !value) continue;
			values[recordId] ??= {};
			values[recordId][row.definitionId] = value;
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

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type CustomFieldValuesRefusal =
	| CustomFieldValueRefusal
	/** Not an active-or-archived field of this record kind in this organization. */
	| "unknown_field"
	| "field_archived"
	/** Above the writer's edit level (or a field they can't see). */
	| "not_editable"
	/** A required field the writer may edit is left without a value. */
	| "missing_required";

const REFUSAL_MESSAGES: Record<CustomFieldValuesRefusal, string> = {
	invalid_value: "has an invalid value",
	text_too_long: "is longer than 255 characters",
	invalid_number: "needs a number",
	number_not_integer: "needs a whole number",
	number_out_of_range: "is outside the allowed range",
	invalid_date: "needs a valid date",
	invalid_option: "needs one of its options",
	option_archived: "can't use an archived option",
	unknown_field: "doesn't exist",
	field_archived: "is archived",
	not_editable: "can't be changed by you",
	missing_required: "is required",
};

/** A refused custom field value write. The message is safe to show users. */
export class CustomFieldValuesRefused extends Error {
	constructor(
		readonly reason: CustomFieldValuesRefusal,
		readonly fieldId: string,
		readonly fieldName: string | null,
	) {
		super(
			fieldName
				? `Custom field "${fieldName}" ${REFUSAL_MESSAGES[reason]}`
				: `A custom field ${REFUSAL_MESSAGES[reason]}`,
		);
		this.name = "CustomFieldValuesRefused";
	}
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 * - Every listed field must be an active field of this record kind that the
 *   writer's `level` may edit, and the input must pass the field's type rules.
 * - `requireComplete` (form saves only): afterwards, every active required
 *   field the writer may edit must have a value. Provisioning paths (SCIM,
 *   invitations, SSO, invite codes, demo data) don't call this at all.
 * - Every change writes an audit entry on the record naming the field and the
 *   old and new value.
 */
export async function writeCustomFieldValues(
	tx: CustomFieldWriter,
	input: {
		organizationId: string;
		actorUserId: string;
		level: CustomFieldViewerLevel | null;
		entity: CustomFieldEntity;
		recordId: string;
		values: unknown;
		requireComplete: boolean;
	},
): Promise<void> {
	if (input.values !== undefined && input.values !== null && !isRecord(input.values)) {
		throw new CustomFieldValuesRefused("invalid_value", "", null);
	}
	const requested = Object.entries(input.values ?? {});
	if (requested.length === 0 && !input.requireComplete) return;

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
				eq(RECORD_COLUMN[input.entity], input.recordId),
				isNull(customFieldValue.validFrom),
			),
		);
	const rowByField = new Map(rows.map((row) => [row.definitionId, row]));
	const current = (field: CustomFieldDefinitionView) => {
		const row = rowByField.get(field.id);
		return row ? storedValue(row, field.type) : null;
	};
	const finalValues: Record<string, CustomFieldValue | null> = {};
	for (const field of fields) finalValues[field.id] = current(field);

	for (const [fieldId, raw] of requested) {
		const field = fieldById.get(fieldId);
		if (!field) throw new CustomFieldValuesRefused("unknown_field", fieldId, null);
		if (!canEditCustomField(input.level, field.editLevel)) {
			throw new CustomFieldValuesRefused("not_editable", fieldId, field.name);
		}
		if (field.archived) throw new CustomFieldValuesRefused("field_archived", fieldId, field.name);
		const before = current(field);
		const parsed = parseCustomFieldValueInput(field, raw, before);
		if (!parsed.ok) throw new CustomFieldValuesRefused(parsed.reason, fieldId, field.name);
		finalValues[fieldId] = parsed.value;
		if (sameCustomFieldValue(before, parsed.value)) continue;
		await writeOne(tx, input, field, rowByField.get(fieldId) ?? null, before, parsed.value);
	}

	if (input.requireComplete) {
		const editableRequired = fields.filter(
			(field) => !field.archived && canEditCustomField(input.level, field.editLevel),
		);
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
	input: {
		organizationId: string;
		actorUserId: string;
		entity: CustomFieldEntity;
		recordId: string;
	},
	field: CustomFieldDefinitionView,
	row: ValueRow | null,
	before: CustomFieldValue | null,
	after: CustomFieldValue | null,
) {
	const scoped = (id: string) =>
		and(eq(customFieldValue.organizationId, input.organizationId), eq(customFieldValue.id, id));
	if (after === null) {
		if (row) await tx.delete(customFieldValue).where(scoped(row.id));
	} else if (row) {
		await tx
			.update(customFieldValue)
			.set({ ...columnsOf(after), updatedAt: sql`now()`, updatedBy: input.actorUserId })
			.where(scoped(row.id));
	} else {
		await tx.insert(customFieldValue).values({
			organizationId: input.organizationId,
			definitionId: field.id,
			employeeId: input.entity === "employee" ? input.recordId : null,
			projectId: input.entity === "project" ? input.recordId : null,
			customerId: input.entity === "customer" ? input.recordId : null,
			...columnsOf(after),
			createdBy: input.actorUserId,
			updatedBy: input.actorUserId,
		});
	}

	await tx.insert(auditLog).values({
		organizationId: input.organizationId,
		entityType: input.entity,
		entityId: input.recordId,
		action:
			before === null
				? AuditAction.CUSTOM_FIELD_VALUE_SET
				: after === null
					? AuditAction.CUSTOM_FIELD_VALUE_CLEARED
					: AuditAction.CUSTOM_FIELD_VALUE_CHANGED,
		performedBy: input.actorUserId,
		changes: JSON.stringify({ before: auditValue(field, before), after: auditValue(field, after) }),
		metadata: JSON.stringify({
			fieldId: field.id,
			fieldName: field.name,
			fieldType: field.type,
			entity: input.entity,
		}),
	});
}

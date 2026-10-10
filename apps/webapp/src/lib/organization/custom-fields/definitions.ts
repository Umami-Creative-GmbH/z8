import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { db } from "@/db";
import { auditLog, customFieldDefinition, customFieldOption } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { isUuid } from "@/lib/billable-time/input";
import {
	type CustomFieldChange,
	type CustomFieldEntity,
	type CustomFieldNumberSettings,
	type CustomFieldRefusal,
	type CustomFieldType,
	type FieldEditLevel,
	type FieldVisibility,
	MAX_ACTIVE_CUSTOM_FIELDS,
	nameKey,
	parseCustomFieldChange,
} from "./definition-rules";
import { lockCustomFieldDefinitions } from "./lock";
import { canonicalStoredDecimal } from "./value-rules";

type Database = typeof db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything that can run a select: the app database or a transaction. */
export type CustomFieldReader = Pick<Transaction, "select">;

export interface CustomFieldOptionView {
	id: string;
	label: string;
	position: number;
	/** Archived options can't be chosen for new values; values that use one keep it. */
	archived: boolean;
}

export interface CustomFieldDefinitionView {
	id: string;
	entity: CustomFieldEntity;
	name: string;
	type: CustomFieldType;
	required: boolean;
	tracked: boolean;
	visibility: FieldVisibility;
	editLevel: FieldEditLevel;
	/** Number settings; null for other types. */
	number: CustomFieldNumberSettings | null;
	position: number;
	archived: boolean;
	/** Select options: active ones in order, then archived ones. Empty for other types. */
	options: CustomFieldOptionView[];
}

export type CustomFieldChangeOutcome =
	| { ok: true; fields: CustomFieldDefinitionView[] }
	| {
			ok: false;
			reason: CustomFieldRefusal;
			/** For `used_as_payroll_identifier`: the payroll configurations using the field (#821). */
			configurations?: string[];
	  };

type DefinitionRow = typeof customFieldDefinition.$inferSelect;
type OptionRow = typeof customFieldOption.$inferSelect;

function numberOf(row: DefinitionRow): CustomFieldNumberSettings | null {
	if (row.type !== "number") return null;
	return {
		integerOnly: row.numberIntegerOnly,
		min: row.numberMin === null ? null : canonicalStoredDecimal(row.numberMin),
		max: row.numberMax === null ? null : canonicalStoredDecimal(row.numberMax),
	};
}

const byPosition = (a: { position: number; id: string }, b: { position: number; id: string }) =>
	a.position - b.position || a.id.localeCompare(b.id);

function viewOf(row: DefinitionRow, options: OptionRow[]): CustomFieldDefinitionView {
	const active = options.filter((o) => o.archivedAt === null).sort(byPosition);
	const archived = options.filter((o) => o.archivedAt !== null).sort(byPosition);
	return {
		id: row.id,
		entity: row.entity as CustomFieldEntity,
		name: row.name,
		type: row.type as CustomFieldType,
		required: row.required,
		tracked: row.tracked,
		visibility: row.visibility as FieldVisibility,
		editLevel: row.editLevel as FieldEditLevel,
		number: numberOf(row),
		position: row.position,
		archived: row.archivedAt !== null,
		options: [...active, ...archived].map((o) => ({
			id: o.id,
			label: o.label,
			position: o.position,
			archived: o.archivedAt !== null,
		})),
	};
}

async function readViews(
	reader: CustomFieldReader,
	organizationId: string,
	filter: { entities?: readonly CustomFieldEntity[]; activeOnly?: boolean },
): Promise<CustomFieldDefinitionView[]> {
	if (filter.entities?.length === 0) return [];
	const rows = await reader
		.select()
		.from(customFieldDefinition)
		.where(
			and(
				eq(customFieldDefinition.organizationId, organizationId),
				filter.entities ? inArray(customFieldDefinition.entity, filter.entities) : undefined,
				filter.activeOnly ? isNull(customFieldDefinition.archivedAt) : undefined,
			),
		)
		.orderBy(
			asc(customFieldDefinition.entity),
			sql`${customFieldDefinition.archivedAt} IS NOT NULL`,
			asc(customFieldDefinition.position),
			asc(customFieldDefinition.id),
		);
	const selectIds = rows.filter((row) => row.type === "select").map((row) => row.id);
	const options =
		selectIds.length === 0
			? []
			: await reader
					.select()
					.from(customFieldOption)
					.where(
						and(
							eq(customFieldOption.organizationId, organizationId),
							inArray(customFieldOption.definitionId, selectIds),
						),
					);
	return rows.map((row) =>
		viewOf(
			row,
			options.filter((o) => o.definitionId === row.id),
		),
	);
}

/**
 * Every custom field of an organization, active and archived, for the settings
 * page: grouped by entity, active fields in order, then archived ones.
 * `entities` limits the result to those record types (all when omitted).
 */
export function listCustomFieldDefinitions(
	reader: CustomFieldReader,
	organizationId: string,
	entities?: readonly CustomFieldEntity[],
): Promise<CustomFieldDefinitionView[]> {
	return readViews(reader, organizationId, { entities });
}

/**
 * The active custom fields for one entity in one organization, in order. Forms,
 * reports and exports follow this order. A select field lists its active
 * options in order, then its archived ones (`archived: true`): offer only the
 * active ones for new values, and show an archived one a record still holds.
 */
export function listActiveCustomFields(
	reader: CustomFieldReader,
	organizationId: string,
	entity: CustomFieldEntity,
): Promise<CustomFieldDefinitionView[]> {
	return readViews(reader, organizationId, { entities: [entity], activeOnly: true });
}

class Refused {
	constructor(
		readonly reason: CustomFieldRefusal,
		readonly configurations?: string[],
	) {}
}

function refuse(reason: CustomFieldRefusal, configurations?: string[]): never {
	throw new Refused(reason, configurations);
}

/**
 * A check another module runs before a field is archived, inside the change's
 * transaction and under the organization's custom field lock. Returns a
 * refusal to keep the field, or null. Payroll uses one so a configuration's
 * personnel identifier can't disappear (#821); the composing server action
 * passes it, so this module doesn't depend on payroll.
 */
export type CustomFieldArchiveGuard = (
	reader: CustomFieldReader,
	field: { organizationId: string; fieldId: string; entity: CustomFieldEntity },
) => Promise<{ reason: CustomFieldRefusal; configurations?: string[] } | null>;

interface ChangeContext {
	tx: Transaction;
	organizationId: string;
	actorUserId: string;
	archiveGuards: readonly CustomFieldArchiveGuard[];
}

async function writeAudit(
	context: ChangeContext,
	entry: {
		entityType: "custom_field" | "custom_field_option";
		entityId: string;
		action: AuditAction;
		changes: Record<string, unknown>;
		metadata: Record<string, unknown>;
	},
) {
	await context.tx.insert(auditLog).values({
		organizationId: context.organizationId,
		entityType: entry.entityType,
		entityId: entry.entityId,
		action: entry.action,
		performedBy: context.actorUserId,
		changes: JSON.stringify(entry.changes),
		metadata: JSON.stringify(entry.metadata),
	});
}

async function loadField(context: ChangeContext, fieldId: string): Promise<DefinitionRow> {
	if (!isUuid(fieldId)) refuse("field_not_found");
	const [row] = await context.tx
		.select()
		.from(customFieldDefinition)
		.where(
			and(
				eq(customFieldDefinition.organizationId, context.organizationId),
				eq(customFieldDefinition.id, fieldId),
			),
		)
		.limit(1);
	return row ?? refuse("field_not_found");
}

async function loadOpenField(context: ChangeContext, fieldId: string): Promise<DefinitionRow> {
	const row = await loadField(context, fieldId);
	if (row.archivedAt !== null) refuse("field_archived");
	return row;
}

async function activeFields(context: ChangeContext, entity: string): Promise<DefinitionRow[]> {
	return context.tx
		.select()
		.from(customFieldDefinition)
		.where(
			and(
				eq(customFieldDefinition.organizationId, context.organizationId),
				eq(customFieldDefinition.entity, entity),
				isNull(customFieldDefinition.archivedAt),
			),
		)
		.orderBy(asc(customFieldDefinition.position), asc(customFieldDefinition.id));
}

const nextPosition = (rows: { position: number }[]) =>
	rows.reduce((max, row) => Math.max(max, row.position + 1), 0);

function assertNameFree(rows: DefinitionRow[], name: string, exceptId?: string) {
	if (rows.some((row) => row.id !== exceptId && nameKey(row.name) === nameKey(name))) {
		refuse("name_taken");
	}
}

async function fieldOptions(context: ChangeContext, fieldId: string): Promise<OptionRow[]> {
	return context.tx
		.select()
		.from(customFieldOption)
		.where(
			and(
				eq(customFieldOption.organizationId, context.organizationId),
				eq(customFieldOption.definitionId, fieldId),
			),
		)
		.orderBy(asc(customFieldOption.position), asc(customFieldOption.id));
}

async function loadOption(
	context: ChangeContext,
	optionId: string,
): Promise<{ option: OptionRow; field: DefinitionRow }> {
	if (!isUuid(optionId)) refuse("option_not_found");
	const [row] = await context.tx
		.select({ option: customFieldOption, field: customFieldDefinition })
		.from(customFieldOption)
		.innerJoin(
			customFieldDefinition,
			and(
				eq(customFieldDefinition.id, customFieldOption.definitionId),
				eq(customFieldDefinition.organizationId, customFieldOption.organizationId),
			),
		)
		.where(
			and(
				eq(customFieldOption.organizationId, context.organizationId),
				eq(customFieldOption.id, optionId),
			),
		)
		.limit(1);
	if (!row) return refuse("option_not_found");
	if (row.field.archivedAt !== null) refuse("field_archived");
	return row;
}

function assertLabelFree(options: OptionRow[], label: string, exceptId?: string) {
	if (
		options.some(
			(o) => o.id !== exceptId && o.archivedAt === null && nameKey(o.label) === nameKey(label),
		)
	) {
		refuse("duplicate_option_label");
	}
}

function sameSet(a: string[], b: string[]) {
	const set = new Set(a);
	return a.length === b.length && b.every((id) => set.has(id));
}

async function insertOption(
	context: ChangeContext,
	field: DefinitionRow,
	label: string,
	position: number,
) {
	const [option] = await context.tx
		.insert(customFieldOption)
		.values({
			organizationId: context.organizationId,
			definitionId: field.id,
			label,
			position,
			createdBy: context.actorUserId,
			updatedBy: context.actorUserId,
		})
		.returning({ id: customFieldOption.id });
	await writeAudit(context, {
		entityType: "custom_field_option",
		entityId: option.id,
		action: AuditAction.CUSTOM_FIELD_OPTION_ADDED,
		changes: { after: { label, position } },
		metadata: { fieldId: field.id, entity: field.entity },
	});
}

function settingsOf(row: DefinitionRow) {
	return {
		required: row.required,
		visibility: row.visibility,
		editLevel: row.editLevel,
		...(row.type === "number" ? { number: numberOf(row) } : {}),
	};
}

type ChangeOf<K extends CustomFieldChange["kind"]> = Extract<CustomFieldChange, { kind: K }>;

async function create(context: ChangeContext, change: ChangeOf<"create">) {
	const active = await activeFields(context, change.entity);
	if (active.length >= MAX_ACTIVE_CUSTOM_FIELDS) refuse("too_many_fields");
	assertNameFree(active, change.name);

	const [row] = await context.tx
		.insert(customFieldDefinition)
		.values({
			organizationId: context.organizationId,
			entity: change.entity,
			name: change.name,
			type: change.type,
			required: change.required,
			tracked: change.tracked,
			visibility: change.visibility,
			editLevel: change.editLevel,
			numberIntegerOnly: change.number?.integerOnly ?? false,
			numberMin: change.number?.min ?? null,
			numberMax: change.number?.max ?? null,
			position: nextPosition(active),
			createdBy: context.actorUserId,
			updatedBy: context.actorUserId,
		})
		.returning();
	await writeAudit(context, {
		entityType: "custom_field",
		entityId: row.id,
		action: AuditAction.CUSTOM_FIELD_CREATED,
		changes: {
			after: {
				name: row.name,
				type: row.type,
				tracked: row.tracked,
				position: row.position,
				...settingsOf(row),
			},
		},
		metadata: { entity: row.entity },
	});
	for (const [index, label] of change.options.entries()) {
		await insertOption(context, row, label, index);
	}
}

async function update(context: ChangeContext, change: ChangeOf<"update">) {
	const row = await loadOpenField(context, change.fieldId);
	if (change.type !== undefined && change.type !== row.type) refuse("type_fixed");
	if (change.tracked !== undefined && change.tracked !== row.tracked) refuse("tracked_fixed");
	if (row.type === "boolean" && change.required) refuse("boolean_cannot_be_required");
	if (nameKey(change.name) !== nameKey(row.name)) {
		assertNameFree(await activeFields(context, row.entity), change.name, row.id);
	}

	const number = row.type === "number" ? (change.number ?? numberOf(row)) : null;
	const next: DefinitionRow = {
		...row,
		name: change.name,
		required: change.required,
		visibility: change.visibility,
		editLevel: change.editLevel,
		numberIntegerOnly: number?.integerOnly ?? false,
		numberMin: number?.min ?? null,
		numberMax: number?.max ?? null,
	};
	const renamed = next.name !== row.name;
	const before = settingsOf(row);
	const after = settingsOf(next);
	const changedKeys = (Object.keys(after) as (keyof typeof after)[]).filter(
		(key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
	);
	if (!renamed && changedKeys.length === 0) return;

	await context.tx
		.update(customFieldDefinition)
		.set({
			name: next.name,
			required: next.required,
			visibility: next.visibility,
			editLevel: next.editLevel,
			numberIntegerOnly: next.numberIntegerOnly,
			numberMin: next.numberMin,
			numberMax: next.numberMax,
			updatedAt: sql`now()`,
			updatedBy: context.actorUserId,
		})
		.where(
			and(
				eq(customFieldDefinition.organizationId, context.organizationId),
				eq(customFieldDefinition.id, row.id),
			),
		);
	if (renamed) {
		await writeAudit(context, {
			entityType: "custom_field",
			entityId: row.id,
			action: AuditAction.CUSTOM_FIELD_RENAMED,
			changes: { before: { name: row.name }, after: { name: next.name } },
			metadata: { entity: row.entity },
		});
	}
	if (changedKeys.length > 0) {
		const pick = (source: typeof after) =>
			Object.fromEntries(changedKeys.map((key) => [key, source[key]]));
		await writeAudit(context, {
			entityType: "custom_field",
			entityId: row.id,
			action: AuditAction.CUSTOM_FIELD_UPDATED,
			changes: { before: pick(before), after: pick(after) },
			metadata: { entity: row.entity },
		});
	}
}

async function setArchived(context: ChangeContext, fieldId: string, archived: boolean) {
	const row = await loadField(context, fieldId);
	if ((row.archivedAt !== null) === archived) return;

	if (archived) {
		for (const guard of context.archiveGuards) {
			const refusal = await guard(context.tx, {
				organizationId: context.organizationId,
				fieldId: row.id,
				entity: row.entity as CustomFieldEntity,
			});
			if (refusal) refuse(refusal.reason, refusal.configurations);
		}
	}

	let position = row.position;
	if (!archived) {
		const active = await activeFields(context, row.entity);
		if (active.length >= MAX_ACTIVE_CUSTOM_FIELDS) refuse("too_many_fields");
		assertNameFree(active, row.name);
		position = nextPosition(active);
	}
	await context.tx
		.update(customFieldDefinition)
		.set({
			archivedAt: archived ? sql`now()` : null,
			position,
			updatedAt: sql`now()`,
			updatedBy: context.actorUserId,
		})
		.where(
			and(
				eq(customFieldDefinition.organizationId, context.organizationId),
				eq(customFieldDefinition.id, row.id),
			),
		);
	await writeAudit(context, {
		entityType: "custom_field",
		entityId: row.id,
		action: archived ? AuditAction.CUSTOM_FIELD_ARCHIVED : AuditAction.CUSTOM_FIELD_RESTORED,
		changes: { before: { archived: !archived }, after: { archived } },
		metadata: { entity: row.entity, name: row.name },
	});
}

async function reorder(context: ChangeContext, change: ChangeOf<"reorder">) {
	const active = await activeFields(context, change.entity);
	if (
		!sameSet(
			active.map((row) => row.id),
			change.fieldIds,
		)
	) {
		refuse("stale_order");
	}
	const byId = new Map(active.map((row) => [row.id, row]));
	for (const [position, id] of change.fieldIds.entries()) {
		const row = byId.get(id);
		if (!row || row.position === position) continue;
		await context.tx
			.update(customFieldDefinition)
			.set({ position, updatedAt: sql`now()`, updatedBy: context.actorUserId })
			.where(
				and(
					eq(customFieldDefinition.organizationId, context.organizationId),
					eq(customFieldDefinition.id, id),
				),
			);
		await writeAudit(context, {
			entityType: "custom_field",
			entityId: id,
			action: AuditAction.CUSTOM_FIELD_REORDERED,
			changes: { before: { position: row.position }, after: { position } },
			metadata: { entity: row.entity, name: row.name },
		});
	}
}

async function addOption(context: ChangeContext, change: ChangeOf<"addOption">) {
	const field = await loadOpenField(context, change.fieldId);
	if (field.type !== "select") refuse("not_select");
	const options = await fieldOptions(context, field.id);
	assertLabelFree(options, change.label);
	await insertOption(
		context,
		field,
		change.label,
		nextPosition(options.filter((o) => o.archivedAt === null)),
	);
}

async function updateOption(
	context: ChangeContext,
	option: OptionRow,
	field: DefinitionRow,
	values: { label?: string; position?: number; archived?: boolean },
	audit: { action: AuditAction; changes: Record<string, unknown> },
) {
	await context.tx
		.update(customFieldOption)
		.set({
			label: values.label,
			position: values.position,
			...(values.archived === undefined ? {} : { archivedAt: values.archived ? sql`now()` : null }),
			updatedAt: sql`now()`,
			updatedBy: context.actorUserId,
		})
		.where(
			and(
				eq(customFieldOption.organizationId, context.organizationId),
				eq(customFieldOption.id, option.id),
			),
		);
	await writeAudit(context, {
		entityType: "custom_field_option",
		entityId: option.id,
		action: audit.action,
		changes: audit.changes,
		metadata: { fieldId: field.id, entity: field.entity },
	});
}

async function renameOption(context: ChangeContext, change: ChangeOf<"renameOption">) {
	const { option, field } = await loadOption(context, change.optionId);
	if (option.label === change.label) return;
	if (option.archivedAt === null) {
		assertLabelFree(await fieldOptions(context, field.id), change.label, option.id);
	}
	await updateOption(
		context,
		option,
		field,
		{ label: change.label },
		{
			action: AuditAction.CUSTOM_FIELD_OPTION_RENAMED,
			changes: { before: { label: option.label }, after: { label: change.label } },
		},
	);
}

async function setOptionArchived(context: ChangeContext, optionId: string, archived: boolean) {
	const { option, field } = await loadOption(context, optionId);
	if ((option.archivedAt !== null) === archived) return;
	const options = await fieldOptions(context, field.id);
	const active = options.filter((o) => o.archivedAt === null);
	let position = option.position;
	if (archived) {
		if (active.length <= 1) refuse("last_active_option");
	} else {
		assertLabelFree(options, option.label, option.id);
		position = nextPosition(active);
	}
	await updateOption(
		context,
		option,
		field,
		{ archived, position },
		{
			action: archived
				? AuditAction.CUSTOM_FIELD_OPTION_ARCHIVED
				: AuditAction.CUSTOM_FIELD_OPTION_RESTORED,
			changes: { before: { archived: !archived }, after: { archived }, label: option.label },
		},
	);
}

async function reorderOptions(context: ChangeContext, change: ChangeOf<"reorderOptions">) {
	const field = await loadOpenField(context, change.fieldId);
	if (field.type !== "select") refuse("not_select");
	const active = (await fieldOptions(context, field.id)).filter((o) => o.archivedAt === null);
	if (
		!sameSet(
			active.map((o) => o.id),
			change.optionIds,
		)
	) {
		refuse("stale_order");
	}
	const byId = new Map(active.map((o) => [o.id, o]));
	for (const [position, id] of change.optionIds.entries()) {
		const option = byId.get(id);
		if (!option || option.position === position) continue;
		await updateOption(
			context,
			option,
			field,
			{ position },
			{
				action: AuditAction.CUSTOM_FIELD_OPTION_REORDERED,
				changes: { before: { position: option.position }, after: { position } },
			},
		);
	}
}

async function applyChange(context: ChangeContext, change: CustomFieldChange) {
	switch (change.kind) {
		case "create":
			return create(context, change);
		case "update":
			return update(context, change);
		case "archive":
			return setArchived(context, change.fieldId, true);
		case "restore":
			return setArchived(context, change.fieldId, false);
		case "reorder":
			return reorder(context, change);
		case "addOption":
			return addOption(context, change);
		case "renameOption":
			return renameOption(context, change);
		case "archiveOption":
			return setOptionArchived(context, change.optionId, true);
		case "restoreOption":
			return setOptionArchived(context, change.optionId, false);
		case "reorderOptions":
			return reorderOptions(context, change);
	}
}

/**
 * Applies one org admin's change to the custom fields of an organization
 * (#817): create, rename and configure, reorder, archive and restore fields, and
 * add, rename, reorder, archive and restore select options. Every write is
 * audited in the same transaction. Changes of one organization are serialized,
 * so the 25-active-field cap and unique names hold under concurrency.
 *
 * The caller authorizes the actor as an org admin of `organizationId` first,
 * and passes the archive guards of the modules that depend on fields.
 * Returns every definition of the organization after the change.
 */
export async function changeCustomFields(
	database: Database,
	input: {
		organizationId: string;
		actorUserId: string;
		change: unknown;
		archiveGuards?: readonly CustomFieldArchiveGuard[];
	},
): Promise<CustomFieldChangeOutcome> {
	const parsed = parseCustomFieldChange(input.change);
	if (!parsed.ok) return parsed;

	try {
		return await database.transaction(async (tx) => {
			await lockCustomFieldDefinitions(tx, input.organizationId);
			const context = {
				tx,
				organizationId: input.organizationId,
				actorUserId: input.actorUserId,
				archiveGuards: input.archiveGuards ?? [],
			};
			await applyChange(context, parsed.change);
			const fields = await listCustomFieldDefinitions(tx, input.organizationId);
			return { ok: true, fields } as const;
		});
	} catch (error) {
		// A refusal rolls the whole change back.
		if (error instanceof Refused) {
			return error.configurations
				? { ok: false, reason: error.reason, configurations: error.configurations }
				: { ok: false, reason: error.reason };
		}
		throw error;
	}
}

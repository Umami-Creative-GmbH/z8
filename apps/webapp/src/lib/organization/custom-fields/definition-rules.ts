/**
 * Rules for defining custom fields (#817): what an org admin may ask for when
 * creating or changing a custom field or its select options. Pure; the store
 * (`definitions.ts`) applies the rules that need the database (the active-field
 * cap, fixed type and tracked flag, unique names, archived state).
 *
 * Keep the value lists in sync with the CHECK constraints in
 * `src/db/schema/custom-field.ts`.
 */

export const CUSTOM_FIELD_ENTITIES = ["employee", "project", "customer"] as const;
export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number];

/**
 * The record types the custom fields settings show: projects and customers
 * only while the organization's projects module is on. Definitions of hidden
 * types stay valid data.
 */
export function customFieldSettingsEntities(projectsEnabled: boolean): CustomFieldEntity[] {
	return projectsEnabled ? [...CUSTOM_FIELD_ENTITIES] : ["employee"];
}

export const CUSTOM_FIELD_TYPES = ["text", "number", "date", "select", "boolean"] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

/** Field visibility: the lowest base role that may see a custom field's values. */
export const FIELD_VISIBILITY_LEVELS = ["admin", "manager", "employee"] as const;
export type FieldVisibility = (typeof FIELD_VISIBILITY_LEVELS)[number];

/** Field edit level: the lowest base role that may change values. Employees never edit. */
export const FIELD_EDIT_LEVELS = ["admin", "manager"] as const;
export type FieldEditLevel = (typeof FIELD_EDIT_LEVELS)[number];

/** At most this many active custom fields per entity per organization. */
export const MAX_ACTIVE_CUSTOM_FIELDS = 25;
export const CUSTOM_FIELD_NAME_MAX_LENGTH = 100;
export const CUSTOM_FIELD_OPTION_LABEL_MAX_LENGTH = 100;
/** A text custom field value holds at most this many characters (enforced with values, #818). */
export const CUSTOM_FIELD_TEXT_MAX_LENGTH = 255;

/** Number settings of a number field. Bounds are canonical decimal strings ("-1.5"). */
export interface CustomFieldNumberSettings {
	integerOnly: boolean;
	min: string | null;
	max: string | null;
}

export type CustomFieldChange =
	| {
			kind: "create";
			entity: CustomFieldEntity;
			name: string;
			type: CustomFieldType;
			required: boolean;
			tracked: boolean;
			visibility: FieldVisibility;
			editLevel: FieldEditLevel;
			/** Set for number fields only. */
			number: CustomFieldNumberSettings | null;
			/** Initial option labels of a select field, in order; empty for other types. */
			options: string[];
	  }
	| {
			kind: "update";
			fieldId: string;
			name: string;
			required: boolean;
			visibility: FieldVisibility;
			editLevel: FieldEditLevel;
			/** Applied to number fields only. */
			number: CustomFieldNumberSettings | null;
			/** A requested type; refused by the store when it differs from the stored one. */
			type: CustomFieldType | undefined;
			/** A requested tracked flag; refused by the store when it differs from the stored one. */
			tracked: boolean | undefined;
	  }
	| { kind: "archive"; fieldId: string }
	| { kind: "restore"; fieldId: string }
	| { kind: "reorder"; entity: CustomFieldEntity; fieldIds: string[] }
	| { kind: "addOption"; fieldId: string; label: string }
	| { kind: "renameOption"; optionId: string; label: string }
	| { kind: "archiveOption"; optionId: string }
	| { kind: "restoreOption"; optionId: string }
	| { kind: "reorderOptions"; fieldId: string; optionIds: string[] };

export type CustomFieldRefusal =
	| "invalid_change"
	| "invalid_entity"
	| "invalid_type"
	| "invalid_name"
	| "invalid_level"
	| "employees_never_edit"
	| "edit_level_broader_than_visibility"
	| "boolean_cannot_be_required"
	| "invalid_number_bounds"
	| "select_needs_option"
	| "invalid_option_label"
	| "duplicate_option_label"
	/** A reorder does not list exactly the current active fields or options. */
	| "stale_order"
	// Refused by the store:
	| "type_fixed"
	| "tracked_fixed"
	| "too_many_fields"
	| "name_taken"
	| "field_not_found"
	| "field_archived"
	| "not_select"
	| "option_not_found"
	| "option_archived"
	| "last_active_option"
	/** Archiving a field a payroll configuration uses as personnel identifier (#821). */
	| "used_as_payroll_identifier";

export type ParsedCustomFieldChange =
	| { ok: true; change: CustomFieldChange }
	| { ok: false; reason: CustomFieldRefusal };

const LEVEL_RANK: Record<FieldVisibility, number> = { admin: 0, manager: 1, employee: 2 };

/** Whether `editLevel` reaches no role that `visibility` hides the field from. */
export function isEditLevelWithinVisibility(
	editLevel: FieldEditLevel,
	visibility: FieldVisibility,
): boolean {
	return LEVEL_RANK[editLevel] <= LEVEL_RANK[visibility];
}

/** Name comparison key: unique names and option labels ignore case and outer spaces. */
export function nameKey(name: string): string {
	return name.trim().toLocaleLowerCase("en");
}

class Refusal {
	constructor(readonly reason: CustomFieldRefusal) {}
}

function refuse(reason: CustomFieldRefusal): never {
	throw new Refusal(reason);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function oneOf<T extends string>(
	values: readonly T[],
	value: unknown,
	reason: CustomFieldRefusal,
): T {
	return typeof value === "string" && (values as readonly string[]).includes(value)
		? (value as T)
		: refuse(reason);
}

function id(value: unknown): string {
	return typeof value === "string" && value.length > 0 && value.length <= 64
		? value
		: refuse("invalid_change");
}

function idList(value: unknown): string[] {
	if (!Array.isArray(value)) return refuse("invalid_change");
	const ids = value.map(id);
	if (new Set(ids).size !== ids.length) refuse("stale_order");
	return ids;
}

function flag(value: unknown): boolean {
	if (value === undefined) return false;
	return typeof value === "boolean" ? value : refuse("invalid_change");
}

function name(value: unknown): string {
	const trimmed = typeof value === "string" ? value.trim() : "";
	return trimmed.length > 0 && trimmed.length <= CUSTOM_FIELD_NAME_MAX_LENGTH
		? trimmed
		: refuse("invalid_name");
}

function optionLabel(value: unknown): string {
	const trimmed = typeof value === "string" ? value.trim() : "";
	return trimmed.length > 0 && trimmed.length <= CUSTOM_FIELD_OPTION_LABEL_MAX_LENGTH
		? trimmed
		: refuse("invalid_option_label");
}

function levels(input: Record<string, unknown>) {
	const visibility = oneOf(FIELD_VISIBILITY_LEVELS, input.visibility, "invalid_level");
	if (input.editLevel === "employee") refuse("employees_never_edit");
	const editLevel = oneOf(FIELD_EDIT_LEVELS, input.editLevel, "invalid_level");
	if (!isEditLevelWithinVisibility(editLevel, visibility)) {
		refuse("edit_level_broader_than_visibility");
	}
	return { visibility, editLevel };
}

const DECIMAL = /^(-?)(\d{1,15})(?:[.,](\d{1,6}))?$/;

/** A canonical decimal string: no leading or trailing zeros, "." separator, no "-0". */
function bound(value: unknown, integerOnly: boolean): string | null {
	if (value === undefined || value === null || value === "") return null;
	const text = typeof value === "number" ? String(value) : value;
	const match = typeof text === "string" ? DECIMAL.exec(text.trim()) : null;
	if (!match) return refuse("invalid_number_bounds");
	const integer = match[2].replace(/^0+(?=\d)/, "");
	const fraction = (match[3] ?? "").replace(/0+$/, "");
	if (integerOnly && fraction !== "") refuse("invalid_number_bounds");
	const sign = integer === "0" && fraction === "" ? "" : match[1];
	return `${sign}${integer}${fraction ? `.${fraction}` : ""}`;
}

function numberSettings(value: unknown): CustomFieldNumberSettings {
	const input = isRecord(value) ? value : {};
	const integerOnly = flag(input.integerOnly);
	const min = bound(input.min, integerOnly);
	const max = bound(input.max, integerOnly);
	if (min !== null && max !== null && Number(min) > Number(max)) refuse("invalid_number_bounds");
	return { integerOnly, min, max };
}

function initialOptions(value: unknown): string[] {
	if (value !== undefined && !Array.isArray(value)) refuse("invalid_change");
	const labels = (value ?? []).map(optionLabel);
	if (labels.length === 0) refuse("select_needs_option");
	if (new Set(labels.map(nameKey)).size !== labels.length) refuse("duplicate_option_label");
	return labels;
}

function parse(input: unknown): CustomFieldChange {
	if (!isRecord(input)) return refuse("invalid_change");
	switch (input.kind) {
		case "create": {
			const entity = oneOf(CUSTOM_FIELD_ENTITIES, input.entity, "invalid_entity");
			const type = oneOf(CUSTOM_FIELD_TYPES, input.type, "invalid_type");
			const fieldName = name(input.name);
			const required = flag(input.required);
			const tracked = flag(input.tracked);
			if (type === "boolean" && required) refuse("boolean_cannot_be_required");
			return {
				kind: "create",
				entity,
				name: fieldName,
				type,
				required,
				tracked,
				...levels(input),
				number: type === "number" ? numberSettings(input.number) : null,
				options: type === "select" ? initialOptions(input.options) : [],
			};
		}
		case "update": {
			const fieldId = id(input.fieldId);
			const fieldName = name(input.name);
			const required = flag(input.required);
			const type =
				input.type === undefined
					? undefined
					: oneOf(CUSTOM_FIELD_TYPES, input.type, "invalid_type");
			const tracked = input.tracked === undefined ? undefined : flag(input.tracked);
			return {
				kind: "update",
				fieldId,
				name: fieldName,
				required,
				...levels(input),
				number:
					input.number === undefined || input.number === null ? null : numberSettings(input.number),
				type,
				tracked,
			};
		}
		case "archive":
		case "restore":
			return { kind: input.kind, fieldId: id(input.fieldId) };
		case "reorder":
			return {
				kind: "reorder",
				entity: oneOf(CUSTOM_FIELD_ENTITIES, input.entity, "invalid_entity"),
				fieldIds: idList(input.fieldIds),
			};
		case "addOption":
			return { kind: "addOption", fieldId: id(input.fieldId), label: optionLabel(input.label) };
		case "renameOption":
			return {
				kind: "renameOption",
				optionId: id(input.optionId),
				label: optionLabel(input.label),
			};
		case "archiveOption":
		case "restoreOption":
			return { kind: input.kind, optionId: id(input.optionId) };
		case "reorderOptions":
			return {
				kind: "reorderOptions",
				fieldId: id(input.fieldId),
				optionIds: idList(input.optionIds),
			};
		default:
			return refuse("invalid_change");
	}
}

/**
 * Parses an org admin's requested custom field change from untrusted input.
 * A malformed id list or a missing id is `invalid_change`; a reorder that lists
 * an id twice is `stale_order`.
 */
export function parseCustomFieldChange(input: unknown): ParsedCustomFieldChange {
	try {
		return { ok: true, change: parse(input) };
	} catch (error) {
		if (error instanceof Refusal) return { ok: false, reason: error.reason };
		throw error;
	}
}

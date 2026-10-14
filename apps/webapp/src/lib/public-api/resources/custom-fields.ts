import { z } from "zod";
import { type PlainDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	CUSTOM_FIELD_TYPES,
	type CustomFieldEntity,
	FIELD_VISIBILITY_LEVELS,
} from "@/lib/organization/custom-fields/definition-rules";
import {
	type CustomFieldDefinitionView,
	listCustomFieldDefinitions,
} from "@/lib/organization/custom-fields/definitions";
import type { CustomFieldValue } from "@/lib/organization/custom-fields/value-rules";
import { customFieldsToday, readCustomFieldValues } from "@/lib/organization/custom-fields/values";
import {
	type CustomFieldViewerLevel,
	canViewCustomField,
} from "@/lib/organization/custom-fields/viewer-level";
import { defineEndpoint, type PublicApiReader } from "../endpoint";
import type { ApiKeyPrincipal } from "../keys/principal";
import { decodeCursor, invalidCursor, pageOf, pageQueryShape, pageSchema } from "../pagination";
import { idSchema, localDateSchema } from "../schemas";
import type { ApiKeyScope } from "../scopes";

/**
 * Custom fields in the Public API (#822). A key has no role (ADR 0001), so its
 * scopes map to a fixed custom field level (ADR 0002): employee-visible fields
 * only, or every field with `custom-fields:read-restricted`. Never the
 * `system` viewer.
 */
export function customFieldLevelOf(
	principal: Pick<ApiKeyPrincipal, "scopes">,
): CustomFieldViewerLevel {
	return principal.scopes.includes("custom-fields:read-restricted") ? "admin" : "employee";
}

const selectValueSchema = z.object({ id: idSchema(), label: z.string() });

const customFieldValueSchema = z
	.union([z.string(), z.boolean(), selectValueSchema, z.null()])
	.describe(
		"Text as written, a number as a decimal string, a date as YYYY-MM-DD, a boolean as is, a select value as its option's id and label. Null without a value.",
	);

type PublicCustomFieldValue = z.infer<typeof customFieldValueSchema>;

export const customFieldsSchema = z
	.record(z.string(), customFieldValueSchema)
	.describe(
		"Every active custom field the key may read, keyed by field id, with its value as of `asOf`. Without the key scope `custom-fields:read-restricted`, only fields every member sees.",
	);

/** The optional `asOf` query parameter of the lists that embed custom field values. */
export const asOfQueryShape = {
	asOf: localDateSchema()
		.optional()
		.describe(
			"The date custom field values are read as of, YYYY-MM-DD. Today in the organization's timezone by default. A tracked field returns the value valid on this date; an untracked field its only value.",
		),
};

/** The `asOf` a list response echoes. */
export const asOfResponseShape = {
	asOf: localDateSchema().describe("The date the `customFields` values were read as of."),
};

function publicValueOf(
	field: CustomFieldDefinitionView,
	value: CustomFieldValue | undefined,
): PublicCustomFieldValue {
	if (!value) return null;
	if (value.type !== "select") return value.value;
	// Archived options keep their label, so a value that uses one still resolves.
	const option = field.options.find((candidate) => candidate.id === value.value);
	return option ? { id: option.id, label: option.label } : null;
}

/**
 * The custom field values of one page of records, read once for the whole page,
 * as the key's level sees them. `asOf` is the query's date, else today in the
 * organization's timezone.
 */
export async function readPageCustomFields(
	database: PublicApiReader,
	input: {
		principal: ApiKeyPrincipal;
		entity: CustomFieldEntity;
		recordIds: readonly string[];
		asOf: string | undefined;
	},
): Promise<{ asOf: string; of(recordId: string): Record<string, PublicCustomFieldValue> }> {
	const { organizationId } = input.principal;
	const asOf: PlainDate = input.asOf
		? parsePlainDate(input.asOf)
		: await customFieldsToday(database, organizationId);
	if (input.recordIds.length === 0) return { asOf: asOf.toString(), of: () => ({}) };

	const read = await readCustomFieldValues(database, {
		organizationId,
		entity: input.entity,
		recordIds: input.recordIds,
		asOf,
		viewer: { kind: "level", level: customFieldLevelOf(input.principal) },
	});
	return {
		asOf: asOf.toString(),
		of: (recordId) =>
			Object.fromEntries(
				read.fields.map((field) => [
					field.id,
					publicValueOf(field, read.values[recordId]?.[field.id]),
				]),
			),
	};
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

const decimal = z.string().nullable();

export const customFieldDefinitionSchema = z
	.object({
		id: idSchema(),
		name: z.string(),
		type: z.enum(CUSTOM_FIELD_TYPES),
		tracked: z
			.boolean()
			.describe("A tracked field has dated values; `asOf` picks the one valid on a date."),
		required: z.boolean(),
		visibility: z
			.enum(FIELD_VISIBILITY_LEVELS)
			.describe(
				"The lowest base role that sees the field. `manager` and `admin` fields need `custom-fields:read-restricted`.",
			),
		archived: z.boolean().describe("Archived fields are left out of `customFields`."),
		position: z.int().describe("The field's place in the order fields are shown in."),
		integerOnly: z.boolean().nullable().describe("Number fields only, else null."),
		min: decimal.describe("A number field's lower bound as a decimal string, else null."),
		max: decimal.describe("A number field's upper bound as a decimal string, else null."),
		options: z
			.array(z.object({ id: idSchema(), label: z.string(), archived: z.boolean() }))
			.describe("A select field's options, active ones first; empty for other types."),
	})
	.meta({ title: "CustomFieldDefinition" });

type PublicCustomFieldDefinition = z.infer<typeof customFieldDefinitionSchema>;

function publicDefinitionOf(field: CustomFieldDefinitionView): PublicCustomFieldDefinition {
	return {
		id: field.id,
		name: field.name,
		type: field.type,
		tracked: field.tracked,
		required: field.required,
		visibility: field.visibility,
		archived: field.archived,
		position: field.position,
		integerOnly: field.number?.integerOnly ?? null,
		min: field.number?.min ?? null,
		max: field.number?.max ?? null,
		options: field.options.map((option) => ({
			id: option.id,
			label: option.label,
			archived: option.archived,
		})),
	};
}

const ENTITY_ENDPOINTS = {
	employee: {
		path: "employees",
		operation: "Employee",
		plural: "employees",
		tag: "Employees",
		scope: "employees:read",
	},
	project: {
		path: "projects",
		operation: "Project",
		plural: "projects",
		tag: "Projects",
		scope: "projects:read",
	},
	customer: {
		path: "customers",
		operation: "Customer",
		plural: "customers",
		tag: "Customers",
		scope: "customers:read",
	},
} as const satisfies Record<
	CustomFieldEntity,
	{ path: string; operation: string; plural: string; tag: string; scope: ApiKeyScope }
>;

/** Position order with the id as tie-breaker: archived fields may share an active field's position. */
const compareFields = (field: { position: number; id: string }, position: number, id: string) =>
	field.position - position || field.id.localeCompare(id);

/** `GET /api/v1/{employees|projects|customers}/custom-fields`, behind the entity's read scope. */
function customFieldDefinitionsEndpoint(entity: CustomFieldEntity) {
	const meta = ENTITY_ENDPOINTS[entity];
	return defineEndpoint({
		method: "GET",
		path: `/api/v1/${meta.path}/custom-fields`,
		operationId: `list${meta.operation}CustomFields`,
		tag: meta.tag,
		summary: `List ${entity} custom fields`,
		description: [
			`The organization's custom fields for ${meta.plural}, active and archived, ordered by position. Each of its ${meta.plural} carries their values in \`customFields\`, keyed by field id.`,
			"",
			"Without the key scope `custom-fields:read-restricted`, fields only managers or admins see are left out, names included.",
		].join("\n"),
		scope: meta.scope,
		query: z.object({
			...pageQueryShape,
			status: z
				.enum(["active", "archived"])
				.optional()
				.describe("Only fields with this status. Both by default."),
		}),
		response: pageSchema(customFieldDefinitionSchema),
		async run({ principal, query, database }) {
			const after = query.cursor ? decodeCursor(query.cursor, ["number", "uuid"]) : null;
			if (query.cursor && !after) return invalidCursor();
			const level = customFieldLevelOf(principal);
			const fields = (
				await listCustomFieldDefinitions(database, principal.organizationId, [entity])
			)
				.filter((field) => canViewCustomField(level, field.visibility))
				.filter((field) => !query.status || field.archived === (query.status === "archived"))
				.sort((a, b) => compareFields(a, b.position, b.id))
				.filter((field) => !after || compareFields(field, Number(after[0]), String(after[1])) > 0);
			const page = pageOf(fields, query.limit, publicDefinitionOf, (field) => [
				field.position,
				field.id,
			]);
			return { ok: true, body: page, rowCount: page.data.length };
		},
	});
}

export const listEmployeeCustomFields = customFieldDefinitionsEndpoint("employee");
export const listProjectCustomFields = customFieldDefinitionsEndpoint("project");
export const listCustomerCustomFields = customFieldDefinitionsEndpoint("customer");

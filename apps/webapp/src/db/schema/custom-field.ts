import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	foreignKey,
	index,
	integer,
	numeric,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";

/**
 * Custom field definitions (#817, spec #769): a piece of data an organization
 * defines for itself on employees, projects or customers. See the Organization
 * glossary (`src/lib/organization/CONTEXT.md`) and ADR 0001.
 *
 * - `entity` and `type` are fixed at creation, as is `tracked`.
 * - `visibility` / `edit_level`: the lowest base role that may see / change the
 *   values. Employees never edit, and the edit level is never broader than the
 *   visibility.
 * - Fields are archived (`archived_at`), never deleted; archived fields keep
 *   their values and do not count towards the 25-active-field cap.
 * - `position` orders the active fields of one entity (forms, reports, exports).
 *
 * `UNIQUE(id, organization_id)` is the target of the value table's composite
 * same-organization foreign key (ADR 0001, #818).
 *
 * Keep the value lists in sync with `src/lib/organization/custom-fields/definition-rules.ts`.
 */
export const customFieldDefinition = pgTable(
	"custom_field_definition",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		entity: text("entity").notNull(),
		name: text("name").notNull(),
		type: text("type").notNull(),
		required: boolean("required").default(false).notNull(),
		tracked: boolean("tracked").default(false).notNull(),
		visibility: text("visibility").notNull(),
		editLevel: text("edit_level").notNull(),
		numberIntegerOnly: boolean("number_integer_only").default(false).notNull(),
		numberMin: numeric("number_min"),
		numberMax: numeric("number_max"),
		position: integer("position").notNull(),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
		updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		unique("custom_field_definition_id_organization_id_unique").on(table.id, table.organizationId),
		check(
			"custom_field_definition_entity_check",
			sql`${table.entity} IN ('employee', 'project', 'customer')`,
		),
		check(
			"custom_field_definition_type_check",
			sql`${table.type} IN ('text', 'number', 'date', 'select', 'boolean')`,
		),
		check(
			"custom_field_definition_visibility_check",
			sql`${table.visibility} IN ('admin', 'manager', 'employee')`,
		),
		check(
			"custom_field_definition_edit_level_check",
			sql`${table.editLevel} IN ('admin', 'manager') AND NOT (${table.visibility} = 'admin' AND ${table.editLevel} = 'manager')`,
		),
		check(
			"custom_field_definition_boolean_not_required_check",
			sql`NOT (${table.type} = 'boolean' AND ${table.required})`,
		),
		check(
			"custom_field_definition_number_settings_check",
			sql`${table.type} = 'number' OR (${table.numberIntegerOnly} = false AND ${table.numberMin} IS NULL AND ${table.numberMax} IS NULL)`,
		),
		check(
			"custom_field_definition_number_bounds_check",
			sql`${table.numberMin} IS NULL OR ${table.numberMax} IS NULL OR ${table.numberMin} <= ${table.numberMax}`,
		),
		check(
			"custom_field_definition_name_check",
			sql`length(btrim(${table.name})) BETWEEN 1 AND 100`,
		),
		index("custom_field_definition_organization_entity_idx").on(
			table.organizationId,
			table.entity,
			table.position,
		),
	],
);

/**
 * Options of a select custom field (#817). Archived, never deleted: an archived
 * option can't be chosen for new values, but values that use it keep it.
 *
 * `UNIQUE(id, definition_id)` lets the value table refer to an option of the
 * same field (#818); the option's field is in the same organization through
 * the composite foreign key.
 */
export const customFieldOption = pgTable(
	"custom_field_option",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		definitionId: uuid("definition_id").notNull(),
		label: text("label").notNull(),
		position: integer("position").notNull(),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
		updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		foreignKey({
			name: "custom_field_option_definition_fk",
			columns: [table.definitionId, table.organizationId],
			foreignColumns: [customFieldDefinition.id, customFieldDefinition.organizationId],
		}).onDelete("cascade"),
		unique("custom_field_option_id_definition_id_unique").on(table.id, table.definitionId),
		check("custom_field_option_label_check", sql`length(btrim(${table.label})) BETWEEN 1 AND 100`),
		index("custom_field_option_definition_idx").on(
			table.organizationId,
			table.definitionId,
			table.position,
		),
	],
);

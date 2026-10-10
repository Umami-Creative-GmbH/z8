import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	date,
	foreignKey,
	index,
	integer,
	numeric,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { customer } from "./customer";
import { employee } from "./organization";
import { project } from "./project";

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
 * `UNIQUE(id, organization_id)` is the target of the option table's composite
 * same-organization foreign key, `UNIQUE(id, organization_id, tracked)` the
 * value table's (ADR 0001, #818, #819): a value carries its field's tracked flag.
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
		unique("custom_field_definition_id_organization_id_tracked_unique").on(
			table.id,
			table.organizationId,
			table.tracked,
		),
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

/**
 * Custom field values (#818, ADR 0001): typed rows, one per value.
 *
 * - Each row points at exactly one employee, project or customer through its
 *   own foreign key (CHECK `custom_field_value_one_record_check`). Every
 *   foreign key is composite with `organization_id`, so the record, the field
 *   and the organization always match; a select option must belong to the
 *   value's field. Values are deleted with their record or field (cascade).
 * - The value sits in the column of its field's type; exactly one is set.
 *   Whether that column matches the field's type, and whether the field is
 *   for that kind of record, is checked by the value store.
 * - `valid_from` is the plain calendar date a tracked field's value is valid
 *   from (#819). `tracked` copies the field's tracked flag through the
 *   definition foreign key, so the database enforces that tracked values have a
 *   valid-from date and untracked ones don't (`custom_field_value_valid_from_check`).
 *   A record holds at most one undated value per field and at most one value per
 *   field and valid-from date (partial unique indexes per record kind).
 *
 * Adding a record kind (time entries are planned) means another nullable
 * foreign key column and a wider CHECK.
 */
export const customFieldValue = pgTable(
	"custom_field_value",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		definitionId: uuid("definition_id").notNull(),
		employeeId: uuid("employee_id"),
		projectId: uuid("project_id"),
		customerId: uuid("customer_id"),
		textValue: text("text_value"),
		numberValue: numeric("number_value"),
		dateValue: date("date_value", { mode: "string" }),
		booleanValue: boolean("boolean_value"),
		selectOptionId: uuid("select_option_id"),
		validFrom: date("valid_from", { mode: "string" }),
		tracked: boolean("tracked").default(false).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
		updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		foreignKey({
			name: "custom_field_value_definition_fk",
			columns: [table.definitionId, table.organizationId, table.tracked],
			foreignColumns: [
				customFieldDefinition.id,
				customFieldDefinition.organizationId,
				customFieldDefinition.tracked,
			],
		}).onDelete("cascade"),
		foreignKey({
			name: "custom_field_value_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "custom_field_value_project_fk",
			columns: [table.projectId, table.organizationId],
			foreignColumns: [project.id, project.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "custom_field_value_customer_fk",
			columns: [table.customerId, table.organizationId],
			foreignColumns: [customer.id, customer.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "custom_field_value_select_option_fk",
			columns: [table.selectOptionId, table.definitionId],
			foreignColumns: [customFieldOption.id, customFieldOption.definitionId],
		}).onDelete("cascade"),
		check(
			"custom_field_value_one_record_check",
			sql`num_nonnulls(${table.employeeId}, ${table.projectId}, ${table.customerId}) = 1`,
		),
		check(
			"custom_field_value_one_value_check",
			sql`num_nonnulls(${table.textValue}, ${table.numberValue}, ${table.dateValue}, ${table.booleanValue}, ${table.selectOptionId}) = 1`,
		),
		check(
			"custom_field_value_text_length_check",
			sql`${table.textValue} IS NULL OR length(${table.textValue}) <= 255`,
		),
		check(
			"custom_field_value_valid_from_check",
			sql`${table.tracked} = (${table.validFrom} IS NOT NULL)`,
		),
		uniqueIndex("custom_field_value_employee_undated_unique")
			.on(table.definitionId, table.employeeId)
			.where(sql`${table.employeeId} IS NOT NULL AND ${table.validFrom} IS NULL`),
		uniqueIndex("custom_field_value_project_undated_unique")
			.on(table.definitionId, table.projectId)
			.where(sql`${table.projectId} IS NOT NULL AND ${table.validFrom} IS NULL`),
		uniqueIndex("custom_field_value_customer_undated_unique")
			.on(table.definitionId, table.customerId)
			.where(sql`${table.customerId} IS NOT NULL AND ${table.validFrom} IS NULL`),
		uniqueIndex("custom_field_value_employee_dated_unique")
			.on(table.definitionId, table.employeeId, table.validFrom)
			.where(sql`${table.employeeId} IS NOT NULL AND ${table.validFrom} IS NOT NULL`),
		uniqueIndex("custom_field_value_project_dated_unique")
			.on(table.definitionId, table.projectId, table.validFrom)
			.where(sql`${table.projectId} IS NOT NULL AND ${table.validFrom} IS NOT NULL`),
		uniqueIndex("custom_field_value_customer_dated_unique")
			.on(table.definitionId, table.customerId, table.validFrom)
			.where(sql`${table.customerId} IS NOT NULL AND ${table.validFrom} IS NOT NULL`),
		index("custom_field_value_employee_idx").on(table.organizationId, table.employeeId),
		index("custom_field_value_project_idx").on(table.organizationId, table.projectId),
		index("custom_field_value_customer_idx").on(table.organizationId, table.customerId),
	],
);

import { type SQL, sql } from "drizzle-orm";
import {
	boolean,
	check,
	foreignKey,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";

export const equipmentPolicy = pgTable(
	"equipment_policy",
	{
		organizationId: text("organization_id")
			.primaryKey()
			.references(() => organization.id, { onDelete: "cascade" }),
		retentionMonths: integer("retention_months").notNull(),
		revision: integer("revision").notNull().default(1),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedBy: text("updated_by").references(() => user.id, {
			onDelete: "set null",
		}),
	},
	(t) => [
		check("equipment_policy_retention_positive", sql`${t.retentionMonths} > 0`),
		check("equipment_policy_revision_positive", sql`${t.revision} > 0`),
	],
);

export const equipmentType = pgTable(
	"equipment_type",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		trackingMode: text("tracking_mode", {
			enum: ["individual", "quantity"],
		}).notNull(),
		defaultReturnRequired: boolean("default_return_required").notNull(),
		usedAt: timestamp("used_at", { withTimezone: true }),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		revision: integer("revision").notNull().default(1),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		createdBy: text("created_by").references(() => user.id, {
			onDelete: "set null",
		}),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedBy: text("updated_by").references(() => user.id, {
			onDelete: "set null",
		}),
	},
	(t) => [
		unique("equipment_type_id_org_unique").on(t.id, t.organizationId),
		check(
			"equipment_type_name_check",
			sql`length(btrim(${t.name})) between 1 and 100`,
		),
		check(
			"equipment_type_tracking_check",
			sql`${t.trackingMode} in ('individual', 'quantity')`,
		),
		check("equipment_type_revision_positive", sql`${t.revision} > 0`),
	],
);

/** Identity reservations have no soft-delete filter: archival/retirement never frees a key. */
export const equipmentItem = pgTable(
	"equipment_item",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		typeId: uuid("type_id").notNull(),
		identifier: text("identifier").notNull(),
		identifierKey: text("identifier_key")
			.notNull()
			.generatedAlwaysAs(
				(): SQL =>
					sql`lower(regexp_replace(${equipmentItem.identifier}, '^[[:space:]]+|[[:space:]]+$', '', 'g'))`,
			),
		serialNumber: text("serial_number"),
		status: text("status", { enum: ["available", "unavailable", "retired"] })
			.notNull()
			.default("available"),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		revision: integer("revision").notNull().default(1),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		createdBy: text("created_by").references(() => user.id, {
			onDelete: "set null",
		}),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedBy: text("updated_by").references(() => user.id, {
			onDelete: "set null",
		}),
	},
	(t) => [
		unique("equipment_item_id_org_unique").on(t.id, t.organizationId),
		uniqueIndex("equipment_item_identifier_org_unique").on(
			t.organizationId,
			t.identifierKey,
		),
		foreignKey({
			name: "equipment_item_type_org_fk",
			columns: [t.typeId, t.organizationId],
			foreignColumns: [equipmentType.id, equipmentType.organizationId],
		}),
		check(
			"equipment_item_identifier_check",
			sql`length(${t.identifierKey}) between 1 and 100`,
		),
		check(
			"equipment_item_serial_check",
			sql`${t.serialNumber} is null or length(${t.serialNumber}) between 1 and 200`,
		),
		check(
			"equipment_item_status_check",
			sql`${t.status} in ('available', 'unavailable', 'retired')`,
		),
		check("equipment_item_revision_positive", sql`${t.revision} > 0`),
	],
);

/** Stores only a command digest and nonpersonal result, never the submitted free text. */
export const equipmentSetupCommand = pgTable(
	"equipment_setup_command",
	{
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		requestId: uuid("request_id").notNull(),
		fingerprint: text("fingerprint").notNull(),
		result: jsonb("result")
			.$type<{ ok: true; id: string; revision: number }>()
			.notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.organizationId, t.requestId] })],
);

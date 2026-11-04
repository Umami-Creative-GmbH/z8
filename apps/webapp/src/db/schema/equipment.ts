import { type SQL, sql } from "drizzle-orm";
import {
	boolean,
	check,
	date,
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
import {
	employeeDeparture,
	employeeEmploymentPeriod,
} from "./employee-lifecycle";
import { employee } from "./organization";

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
		/** Nonpersonal custody survives deletion of retained employee history. */
		inCustody: boolean("in_custody").notNull().default(false),
		lastHandoverDate: date("last_handover_date"),
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
		unique("equipment_item_id_org_type_unique").on(
			t.id,
			t.organizationId,
			t.typeId,
		),
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

/** An agreement is personal history; it is never the source of item availability. */
export const equipmentAssignment = pgTable(
	"equipment_assignment",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		itemId: uuid("item_id"),
		typeId: uuid("type_id").notNull(),
		quantity: integer("quantity").notNull().default(1),
		receivedQuantity: integer("received_quantity").notNull().default(0),
		employeeId: uuid("employee_id"),
		employmentPeriodId: uuid("employment_period_id"),
		returnRequired: boolean("return_required").notNull(),
		explicitDeadline: date("explicit_deadline"),
		departureDeadline: date("departure_deadline"),
		departureId: uuid("departure_id"),
		received: boolean("received").notNull().default(false),
		revision: integer("revision").notNull().default(1),
	},
	(t) => [
		unique("equipment_assignment_id_org_unique").on(t.id, t.organizationId),
		foreignKey({
			name: "equipment_assignment_departure_org_fk",
			columns: [t.departureId, t.organizationId],
			foreignColumns: [employeeDeparture.id, employeeDeparture.organizationId],
		}),
		foreignKey({
			name: "equipment_assignment_type_org_fk",
			columns: [t.typeId, t.organizationId],
			foreignColumns: [equipmentType.id, equipmentType.organizationId],
		}),
		check(
			"equipment_assignment_quantity_check",
			sql`${t.quantity} > 0 and (${t.itemId} is null or ${t.quantity} = 1)`,
		),
		check(
			"equipment_assignment_received_quantity_check",
			sql`${t.receivedQuantity} >= 0 and ${t.receivedQuantity} <= ${t.quantity}`,
		),
		check(
			"equipment_assignment_received_check",
			sql`${t.received} = (${t.receivedQuantity} = ${t.quantity})`,
		),
		uniqueIndex("equipment_assignment_one_holder")
			.on(t.organizationId, t.itemId)
			.where(sql`${t.received} = false`),
		foreignKey({
			name: "equipment_assignment_item_org_fk",
			columns: [t.itemId, t.organizationId, t.typeId],
			foreignColumns: [
				equipmentItem.id,
				equipmentItem.organizationId,
				equipmentItem.typeId,
			],
		}),
		foreignKey({
			name: "equipment_assignment_employee_org_fk",
			columns: [t.employeeId, t.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}),
		foreignKey({
			name: "equipment_assignment_period_org_employee_fk",
			columns: [t.employmentPeriodId, t.organizationId, t.employeeId],
			foreignColumns: [
				employeeEmploymentPeriod.id,
				employeeEmploymentPeriod.organizationId,
				employeeEmploymentPeriod.employeeId,
			],
		}),
		check(
			"equipment_assignment_deadline_check",
			sql`${t.returnRequired} or (${t.explicitDeadline} is null and ${t.departureDeadline} is null)`,
		),
		check("equipment_assignment_revision_positive", sql`${t.revision} > 0`),
	],
);

export const equipmentHandover = pgTable(
	"equipment_handover",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		assignmentId: uuid("assignment_id").notNull(),
		kind: text("kind", { enum: ["issue", "receipt"] }).notNull(),
		quantity: integer("quantity").notNull().default(1),
		actualDate: date("actual_date").notNull(),
		condition: text("condition", {
			enum: ["good", "worn", "damaged", "unknown"],
		}).notNull(),
		notes: text("notes"),
		actorId: text("actor_id").references(() => user.id, {
			onDelete: "set null",
		}),
		recordedAt: timestamp("recorded_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		foreignKey({
			name: "equipment_handover_assignment_org_fk",
			columns: [t.assignmentId, t.organizationId],
			foreignColumns: [
				equipmentAssignment.id,
				equipmentAssignment.organizationId,
			],
		}).onDelete("cascade"),
		uniqueIndex("equipment_handover_issue_once")
			.on(t.organizationId, t.assignmentId)
			.where(sql`${t.kind} = 'issue'`),
		check("equipment_handover_quantity_positive", sql`${t.quantity} > 0`),
		check(
			"equipment_handover_kind_check",
			sql`${t.kind} in ('issue', 'receipt')`,
		),
		check(
			"equipment_handover_condition_check",
			sql`${t.condition} in ('good', 'worn', 'damaged', 'unknown')`,
		),
		check(
			"equipment_handover_notes_check",
			sql`${t.notes} is null or length(${t.notes}) <= 4000`,
		),
	],
);

/** Actor-bound replay stores no handover free text. */
export const equipmentCommand = pgTable(
	"equipment_command",
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

/** One revisioned responsibility per officer; revocation keeps its stale-form fence. */
export const equipmentOfficerGrant = pgTable(
	"equipment_officer_grant",
	{
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		scope: text("scope", { enum: ["all", "selected"] }).notNull(),
		teamIds: uuid("team_ids").array().notNull().default(sql`'{}'::uuid[]`),
		employeeIds: uuid("employee_ids")
			.array()
			.notNull()
			.default(sql`'{}'::uuid[]`),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		revision: integer("revision").notNull().default(1),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedBy: text("updated_by").references(() => user.id, {
			onDelete: "set null",
		}),
	},
	(t) => [
		primaryKey({ columns: [t.organizationId, t.employeeId] }),
		foreignKey({
			columns: [t.employeeId, t.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		check(
			"equipment_officer_scope_check",
			sql`(${t.scope} = 'all' and cardinality(${t.teamIds}) = 0 and cardinality(${t.employeeIds}) = 0) or (${t.scope} = 'selected' and cardinality(${t.teamIds}) + cardinality(${t.employeeIds}) > 0)`,
		),
		check("equipment_officer_revision_positive", sql`${t.revision} > 0`),
	],
);

/** Lifecycle supplies this before roster cleanup. Never infer former scope from the live roster. */
export const equipmentFormerTeamScope = pgTable(
	"equipment_former_team_scope",
	{
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		teamIds: uuid("team_ids").array().notNull(),
		capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.organizationId, t.employeeId] }),
		foreignKey({
			columns: [t.employeeId, t.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
	],
);

/** Readiness decisions supplement physical handovers; they never rewrite receipt evidence. */
export const equipmentItemReadinessEvent = pgTable(
	"equipment_item_readiness_event",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		itemId: uuid("item_id").notNull(),
		itemRevision: integer("item_revision").notNull(),
		kind: text("kind", {
			enum: ["clearance", "unavailable", "retired"],
		}).notNull(),
		actorId: text("actor_id").references(() => user.id, {
			onDelete: "set null",
		}),
		recordedAt: timestamp("recorded_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		foreignKey({
			name: "equipment_readiness_item_org_fk",
			columns: [t.itemId, t.organizationId],
			foreignColumns: [equipmentItem.id, equipmentItem.organizationId],
		}).onDelete("cascade"),
		unique("equipment_readiness_item_revision_unique").on(
			t.organizationId,
			t.itemId,
			t.itemRevision,
		),
		check(
			"equipment_readiness_kind_check",
			sql`${t.kind} in ('clearance', 'unavailable', 'retired')`,
		),
		check("equipment_readiness_revision_positive", sql`${t.itemRevision} > 0`),
	],
);

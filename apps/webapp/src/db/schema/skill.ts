import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	date,
	foreignKey,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import type { ExpiryReminderKind } from "@/lib/expiry-reminders/expiry.types";
import { organization, user } from "../auth-schema";
import { skillCategoryEnum } from "./enums";
import { employee, locationSubarea } from "./organization";
import { shift, shiftTemplate } from "./shift";
import { currentTimestamp } from "./timestamp";

// ============================================
// SKILL CATALOG & QUALIFICATIONS
// ============================================

/**
 * Organization-level skill catalog
 * Skills are reusable definitions that can be assigned to employees
 * and required by subareas or shift templates.
 */
export const skill = pgTable(
	"skill",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Basic info
		name: text("name").notNull(), // "Forklift License", "Food Safety Certification"
		description: text("description"),
		category: skillCategoryEnum("category").notNull(),

		// For custom categories
		customCategoryName: text("custom_category_name"),

		// Whether this skill requires expiry tracking (certifications typically do)
		requiresExpiry: boolean("requires_expiry").default(false).notNull(),

		isActive: boolean("is_active").default(true).notNull(),

		// Audit
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id),
	},
	(table) => [
		index("skill_organizationId_idx").on(table.organizationId),
		index("skill_category_idx").on(table.category),
		index("skill_isActive_idx").on(table.isActive),
		uniqueIndex("skill_org_name_idx").on(table.organizationId, table.name),
	],
);

/**
 * Employee skill assignments (qualifications)
 * Junction table linking employees to skills with optional expiry dates.
 */
export const employeeSkill = pgTable(
	"employee_skill",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		skillId: uuid("skill_id")
			.notNull()
			.references(() => skill.id, { onDelete: "cascade" }),

		// Skill expiry date (#1142): the last valid day, a plain day on the organization's
		// calendar (`YYYY-MM-DD`); null = never expires. Compare it only through
		// `isExpiredSkillOn` in `@/lib/scheduling/skill-expiry`.
		expiresAt: date("expires_at", { mode: "string" }),

		// Optional notes (certification number, training date, etc.)
		notes: text("notes"),

		// Audit
		assignedBy: text("assigned_by")
			.notNull()
			.references(() => user.id),
		assignedAt: timestamp("assigned_at").defaultNow().notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("employeeSkill_employeeId_idx").on(table.employeeId),
		index("employeeSkill_skillId_idx").on(table.skillId),
		index("employeeSkill_expiresAt_idx").on(table.expiresAt),
		uniqueIndex("employeeSkill_unique_idx").on(table.employeeId, table.skillId),
		// Target of employee-scoped references such as a skill certificate's link (#1144).
		unique("employeeSkill_id_employeeId_idx").on(table.id, table.employeeId),
	],
);

/**
 * Skill reminder settings of an organization (#1143). No row means the
 * default 30-day lead time. Separate from the personnel file reminder setting:
 * skills exist without personnel files. Only owners and admins change it.
 */
export const skillReminderSetting = pgTable(
	"skill_reminder_setting",
	{
		organizationId: text("organization_id")
			.primaryKey()
			.references(() => organization.id, { onDelete: "cascade" }),
		expiryLeadDays: integer("expiry_lead_days").default(30).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		check("skill_reminder_setting_lead_days_check", sql`${table.expiryLeadDays} BETWEEN 1 AND 365`),
	],
);

/**
 * Sent marker of the skill expiry reminder job (#1143): one row per employee
 * skill, kind and skill expiry date, claimed before notifying, so each reminder
 * is sent at most once. Keying on the date re-arms both reminders when it
 * moves; the job also drops markers of a date the employee skill no longer
 * has. Scoped to the organization through the employee.
 */
export const skillExpiryReminder = pgTable(
	"skill_expiry_reminder",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		employeeSkillId: uuid("employee_skill_id").notNull(),
		kind: text("kind").$type<ExpiryReminderKind>().notNull(),
		expiryDate: date("expiry_date", { mode: "string" }).notNull(),
		sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("skillExpiryReminder_employeeSkill_kind_expiry_idx").on(
			table.employeeSkillId,
			table.kind,
			table.expiryDate,
		),
		index("skillExpiryReminder_organizationId_idx").on(table.organizationId),
		check("skill_expiry_reminder_kind_check", sql`${table.kind} IN ('upcoming', 'expired_today')`),
		foreignKey({
			name: "skill_expiry_reminder_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "skill_expiry_reminder_employee_skill_fk",
			columns: [table.employeeSkillId, table.employeeId],
			foreignColumns: [employeeSkill.id, employeeSkill.employeeId],
		}).onDelete("cascade"),
	],
);

/**
 * Skill requirements on subareas
 * Defines which skills are required to work in a specific subarea.
 */
export const subareaSkillRequirement = pgTable(
	"subarea_skill_requirement",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		subareaId: uuid("subarea_id")
			.notNull()
			.references(() => locationSubarea.id, { onDelete: "cascade" }),
		skillId: uuid("skill_id")
			.notNull()
			.references(() => skill.id, { onDelete: "cascade" }),

		// Whether this is a hard requirement vs preferred
		isRequired: boolean("is_required").default(true).notNull(),

		// Audit
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("subareaSkillReq_subareaId_idx").on(table.subareaId),
		index("subareaSkillReq_skillId_idx").on(table.skillId),
		uniqueIndex("subareaSkillReq_unique_idx").on(table.subareaId, table.skillId),
	],
);

/**
 * Skill requirements on shift templates
 * Defines which skills are required for shifts created from a template.
 */
export const shiftTemplateSkillRequirement = pgTable(
	"shift_template_skill_requirement",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		templateId: uuid("template_id")
			.notNull()
			.references(() => shiftTemplate.id, { onDelete: "cascade" }),
		skillId: uuid("skill_id")
			.notNull()
			.references(() => skill.id, { onDelete: "cascade" }),

		// Whether this is a hard requirement vs preferred
		isRequired: boolean("is_required").default(true).notNull(),

		// Audit
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("shiftTemplateSkillReq_templateId_idx").on(table.templateId),
		index("shiftTemplateSkillReq_skillId_idx").on(table.skillId),
		uniqueIndex("shiftTemplateSkillReq_unique_idx").on(table.templateId, table.skillId),
	],
);

/**
 * Skill requirement override log
 * Records when a manager assigns an unqualified employee with an override reason.
 * Used for audit trails and compliance reporting.
 *
 * Written only in the transaction that assigns the employee (#893): a shift save
 * or a shift request approval. The assignment context (shift date, subarea,
 * template) is the one the override covered; rows from before #893 have none.
 */
export const skillRequirementOverride = pgTable(
	"skill_requirement_override",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		shiftId: uuid("shift_id")
			.notNull()
			.references(() => shift.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),

		// What skills were missing (JSON array of skill IDs)
		missingSkillIds: text("missing_skill_ids").notNull(),

		// The assignment context the override covered (#893): `shift.date` as stored,
		// the subarea and the template. A later save in the same context needs no new override.
		shiftDate: timestamp("shift_date"),
		subareaId: uuid("subarea_id").references(() => locationSubarea.id, { onDelete: "set null" }),
		templateId: uuid("template_id").references(() => shiftTemplate.id, { onDelete: "set null" }),

		// Override details
		overrideReason: text("override_reason").notNull(),
		overriddenBy: text("overridden_by")
			.notNull()
			.references(() => user.id),
		overriddenAt: timestamp("overridden_at").defaultNow().notNull(),

		// Notification tracking
		notificationSent: boolean("notification_sent").default(false).notNull(),
	},
	(table) => [
		index("skillOverride_organizationId_idx").on(table.organizationId),
		index("skillOverride_shiftId_idx").on(table.shiftId),
		index("skillOverride_employeeId_idx").on(table.employeeId),
		index("skillOverride_overriddenBy_idx").on(table.overriddenBy),
	],
);

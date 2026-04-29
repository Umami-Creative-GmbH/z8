import {
	boolean,
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

import { organization, user } from "../auth-schema";
import { skillCategoryEnum } from "./enums";
import { employee, locationSubarea } from "./organization";
import { shift, shiftTemplate } from "./shift";

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

		// Optional expiry tracking
		expiresAt: timestamp("expires_at", { mode: "date" }), // null = never expires

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

import { sql } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

// Import auth tables for FK references
import { organization, user } from "../auth-schema";
import { holidayPresetAssignmentTypeEnum } from "./enums";
import { employee, team } from "./organization";

// ============================================
// CHANGE POLICY
// ============================================

/**
 * Change Policy Template
 *
 * Defines rules for when employees can edit their time tracking entries.
 * - selfServiceDays: Days back from today where edits are allowed without approval (0 = same day only)
 * - approvalDays: Days back (beyond selfServiceDays) where edits require manager approval
 * - Beyond both windows: only admins/team leads can modify entries
 *
 * Example configurations:
 * - selfServiceDays=0, approvalDays=7: Same-day free edits, 1-7 days need approval
 * - selfServiceDays=0, approvalDays=0: Every clock-out triggers approval (strictest)
 * - noApprovalRequired=true: Unlimited self-service editing (trust mode)
 */
export const changePolicy = pgTable(
	"change_policy",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		name: text("name").notNull(),
		description: text("description"),

		// Policy parameters
		selfServiceDays: integer("self_service_days").default(0).notNull(), // 0 = same day only
		approvalDays: integer("approval_days").default(7).notNull(), // Days beyond selfService that require approval
		noApprovalRequired: boolean("no_approval_required").default(false).notNull(), // Trust mode - bypass all approval
		notifyAllManagers: boolean("notify_all_managers").default(false).notNull(), // Notify all managers vs primary only

		isActive: boolean("is_active").default(true).notNull(),

		// Audit fields
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
		index("changePolicy_organizationId_idx").on(table.organizationId),
		index("changePolicy_isActive_idx").on(table.isActive),
		uniqueIndex("changePolicy_org_name_idx").on(table.organizationId, table.name),
	],
);

/**
 * Change Policy Assignment
 *
 * Hierarchical assignment of policies to organizations, teams, or employees.
 * Uses the same pattern as holiday presets and time regulations.
 *
 * Resolution order (highest priority wins):
 * 1. Employee-specific assignment (priority=2)
 * 2. Team assignment (priority=1)
 * 3. Organization default (priority=0)
 *
 * If no policy is assigned at any level, the system has NO restrictions
 * (employees can edit any time entry freely - this is the default behavior).
 */
export const changePolicyAssignment = pgTable(
	"change_policy_assignment",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		policyId: uuid("policy_id")
			.notNull()
			.references(() => changePolicy.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Assignment target - reuses existing enum
		assignmentType: holidayPresetAssignmentTypeEnum("assignment_type").notNull(),
		teamId: uuid("team_id").references(() => team.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").references(() => employee.id, {
			onDelete: "cascade",
		}),

		// Priority: 0=org, 1=team, 2=employee (higher wins)
		priority: integer("priority").default(0).notNull(),

		// Effective dates - policy only applies within this window
		effectiveFrom: timestamp("effective_from"),
		effectiveUntil: timestamp("effective_until"),

		isActive: boolean("is_active").default(true).notNull(),

		// Audit fields
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("changePolicyAssignment_policyId_idx").on(table.policyId),
		index("changePolicyAssignment_organizationId_idx").on(table.organizationId),
		index("changePolicyAssignment_teamId_idx").on(table.teamId),
		index("changePolicyAssignment_employeeId_idx").on(table.employeeId),
		// Composite index for efficient policy resolution queries
		index("changePolicyAssignment_resolution_idx").on(
			table.organizationId,
			table.assignmentType,
			table.isActive,
		),
		// One org default per organization
		uniqueIndex("changePolicyAssignment_org_default_idx")
			.on(table.organizationId, table.assignmentType)
			.where(sql`assignment_type = 'organization' AND is_active = true`),
		// One assignment per team
		uniqueIndex("changePolicyAssignment_team_idx")
			.on(table.teamId)
			.where(sql`team_id IS NOT NULL AND is_active = true`),
		// One assignment per employee
		uniqueIndex("changePolicyAssignment_employee_idx")
			.on(table.employeeId)
			.where(sql`employee_id IS NOT NULL AND is_active = true`),
	],
);

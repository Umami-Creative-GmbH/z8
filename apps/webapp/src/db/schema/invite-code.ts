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
import { member, organization, user } from "../auth-schema";
import { team } from "./organization";
import { inviteCodeStatusEnum, memberStatusEnum, approvalStatusEnum } from "./enums";

// ============================================
// ORGANIZATION INVITE CODES
// ============================================

/**
 * Organization invite codes for public/semi-public member onboarding
 * Supports usage limits, expiration, and pending member approval
 */
export const inviteCode = pgTable(
	"invite_code",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Human-readable code (TEAM2024, JOIN-ACME, etc.)
		code: text("code").notNull(), // Uppercase, 4-20 chars, alphanumeric + hyphens

		// Display name for admin UI
		label: text("label").notNull(), // e.g., "Public Recruitment 2024"
		description: text("description"),

		// Limits and expiration
		maxUses: integer("max_uses"), // null = unlimited
		currentUses: integer("current_uses").default(0).notNull(),
		expiresAt: timestamp("expires_at"),

		// Default team assignment (optional)
		defaultTeamId: uuid("default_team_id").references(() => team.id, {
			onDelete: "set null",
		}),

		// Requires approval before member is active
		requiresApproval: boolean("requires_approval").default(true).notNull(),

		// Status
		status: inviteCodeStatusEnum("status").default("active").notNull(),

		// Audit fields
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id),
	},
	(table) => [
		index("inviteCode_organizationId_idx").on(table.organizationId),
		index("inviteCode_status_idx").on(table.status),
		// Unique code per organization (case-insensitive handled at app layer)
		uniqueIndex("inviteCode_org_code_idx").on(table.organizationId, table.code),
	],
);

/**
 * Usage tracking for invite codes
 * Records each time a code is used to create a pending member
 */
export const inviteCodeUsage = pgTable(
	"invite_code_usage",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		inviteCodeId: uuid("invite_code_id")
			.notNull()
			.references(() => inviteCode.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		memberId: text("member_id")
			.notNull()
			.references(() => member.id, { onDelete: "cascade" }),

		// Request metadata for audit
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),

		usedAt: timestamp("used_at").defaultNow().notNull(),
	},
	(table) => [
		index("inviteCodeUsage_inviteCodeId_idx").on(table.inviteCodeId),
		index("inviteCodeUsage_userId_idx").on(table.userId),
		index("inviteCodeUsage_memberId_idx").on(table.memberId),
	],
);

/**
 * Pending member approvals
 * Created when admin approves/rejects a pending member
 */
export const memberApproval = pgTable(
	"member_approval",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		memberId: text("member_id")
			.notNull()
			.references(() => member.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Approval decision
		status: approvalStatusEnum("status").notNull(), // approved, rejected

		// Optional team assignment on approval
		assignedTeamId: uuid("assigned_team_id").references(() => team.id, {
			onDelete: "set null",
		}),

		// Approval metadata
		approvedBy: text("approved_by")
			.notNull()
			.references(() => user.id),
		approvedAt: timestamp("approved_at").defaultNow().notNull(),
		notes: text("notes"), // Optional rejection reason or admin notes
	},
	(table) => [
		index("memberApproval_memberId_idx").on(table.memberId),
		index("memberApproval_organizationId_idx").on(table.organizationId),
		index("memberApproval_status_idx").on(table.status),
	],
);

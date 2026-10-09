import { sql } from "drizzle-orm";
import {
	boolean,
	check,
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
import { organization, user } from "../auth-schema";
import { holidayPresetAssignmentTypeEnum } from "./enums";
import { employee, team } from "./organization";
import { currentTimestamp } from "./timestamp";

/**
 * Position capture settings (#766, #825; Time Tracking ADR 0004): one row per
 * organization. The master switch alone captures nothing; capture applies only
 * to the teams and employees assigned in `position_capture_assignment`.
 *
 * Every configuration write (settings or assignments) updates this row inside
 * its transaction, so a clock command that reads the row `FOR SHARE` sees either
 * the configuration before or after the write, never a mix.
 */
export const positionCaptureSetting = pgTable(
	"position_capture_setting",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.unique("positionCaptureSetting_organizationId_idx")
			.references(() => organization.id, { onDelete: "cascade" }),
		enabled: boolean("enabled").default(false).notNull(),
		purposeStatement: text("purpose_statement"),
		retentionDays: integer("retention_days").default(90).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		check(
			"position_capture_setting_retention_check",
			sql`${table.retentionDays} between 7 and 365`,
		),
		check(
			"position_capture_setting_purpose_check",
			sql`${table.enabled} = false or ${table.purposeStatement} is not null`,
		),
	],
);

/**
 * Capture assignments in the assignment-table shape of `change_policy_assignment`
 * (priority 0 = organization, 1 = team, 2 = employee; the most specific wins).
 * `captureEnabled = false` excludes a team or employee from a broader assignment.
 */
export const positionCaptureAssignment = pgTable(
	"position_capture_assignment",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		assignmentType: holidayPresetAssignmentTypeEnum("assignment_type").notNull(),
		teamId: uuid("team_id"),
		employeeId: uuid("employee_id"),
		priority: integer("priority").default(0).notNull(),
		captureEnabled: boolean("capture_enabled").default(true).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("positionCaptureAssignment_organizationId_idx").on(table.organizationId),
		index("positionCaptureAssignment_teamId_idx").on(table.teamId),
		index("positionCaptureAssignment_employeeId_idx").on(table.employeeId),
		uniqueIndex("positionCaptureAssignment_org_idx")
			.on(table.organizationId)
			.where(sql`assignment_type = 'organization'`),
		uniqueIndex("positionCaptureAssignment_team_idx")
			.on(table.organizationId, table.teamId)
			.where(sql`team_id IS NOT NULL`),
		uniqueIndex("positionCaptureAssignment_employee_idx")
			.on(table.organizationId, table.employeeId)
			.where(sql`employee_id IS NOT NULL`),
		check(
			"position_capture_assignment_target_check",
			sql`(${table.assignmentType} = 'organization' and ${table.teamId} is null and ${table.employeeId} is null and ${table.priority} = 0)
			or (${table.assignmentType} = 'team' and ${table.teamId} is not null and ${table.employeeId} is null and ${table.priority} = 1)
			or (${table.assignmentType} = 'employee' and ${table.employeeId} is not null and ${table.teamId} is null and ${table.priority} = 2)`,
		),
		foreignKey({
			name: "position_capture_assignment_team_fk",
			columns: [table.teamId, table.organizationId],
			foreignColumns: [team.id, team.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "position_capture_assignment_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
	],
);

/**
 * Position notice versions: the organization's purpose statement and retention
 * as published, numbered per organization. Z8's fixed text is rendered from
 * `templateRevision`. The highest version is the current notice; publishing one
 * lapses every consent given against an earlier version.
 */
export const positionNotice = pgTable(
	"position_notice",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		version: integer("version").notNull(),
		purposeStatement: text("purpose_statement").notNull(),
		retentionDays: integer("retention_days").notNull(),
		templateRevision: integer("template_revision").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		uniqueIndex("positionNotice_org_version_idx").on(table.organizationId, table.version),
		unique("positionNotice_id_organizationId_idx").on(table.id, table.organizationId),
		check("position_notice_version_check", sql`${table.version} >= 1`),
	],
);

/**
 * Position consents: an employee's agreement to one notice version. Withdrawal
 * sets `withdrawnAt`; agreeing again is a new row. A consent for an earlier
 * version is lapsed, not withdrawn. No positions are stored here.
 */
export const positionConsent = pgTable(
	"position_consent",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		noticeId: uuid("notice_id").notNull(),
		grantedAt: timestamp("granted_at").notNull(),
		withdrawnAt: timestamp("withdrawn_at"),
	},
	(table) => [
		index("positionConsent_organizationId_idx").on(table.organizationId),
		index("positionConsent_employeeId_idx").on(table.employeeId),
		uniqueIndex("positionConsent_unwithdrawn_idx")
			.on(table.employeeId, table.noticeId)
			.where(sql`withdrawn_at IS NULL`),
		check(
			"position_consent_withdrawal_check",
			sql`${table.withdrawnAt} is null or ${table.withdrawnAt} >= ${table.grantedAt}`,
		),
		foreignKey({
			name: "position_consent_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "position_consent_notice_fk",
			columns: [table.noticeId, table.organizationId],
			foreignColumns: [positionNotice.id, positionNotice.organizationId],
		}).onDelete("cascade"),
	],
);

/**
 * "Not now" answers to the consent dialog, one per employee and notice version,
 * so the dialog is not shown again until a new version is published.
 */
export const positionNoticeDecline = pgTable(
	"position_notice_decline",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		noticeId: uuid("notice_id").notNull(),
		declinedAt: timestamp("declined_at").notNull(),
	},
	(table) => [
		index("positionNoticeDecline_organizationId_idx").on(table.organizationId),
		uniqueIndex("positionNoticeDecline_employee_notice_idx").on(table.employeeId, table.noticeId),
		foreignKey({
			name: "position_notice_decline_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "position_notice_decline_notice_fk",
			columns: [table.noticeId, table.organizationId],
			foreignColumns: [positionNotice.id, positionNotice.organizationId],
		}).onDelete("cascade"),
	],
);

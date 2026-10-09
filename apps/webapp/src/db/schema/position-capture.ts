import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	doublePrecision,
	foreignKey,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { holidayPresetAssignmentTypeEnum } from "./enums";
import { employee, team } from "./organization";
import { timeEntry } from "./time-tracking";
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

/**
 * Position stamps (#826, Time Tracking ADR 0004): the device position an
 * employee's own web/PWA clock command carried, kept only when the server check
 * passed inside the clocking work transaction. One stamp per clock event
 * (`time_entry`), outside the hash-chained fields; `time_entry.location` never
 * holds one. Nothing records why a clock event has no stamp.
 *
 * Stamps are immutable: a trigger refuses every update except bringing
 * `purge_at` forward (a shortened retention, #829). Withdrawing consent deletes
 * all of the employee's stamps; the purge job deletes stamps past `purge_at`.
 */
export const positionStamp = pgTable(
	"position_stamp",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		/** The clock event the position was captured with. */
		timeEntryId: uuid("time_entry_id")
			.notNull()
			.references(() => timeEntry.id, { onDelete: "cascade" }),
		/** The consent the stamp was accepted under (current notice, given before the event). */
		consentId: uuid("consent_id")
			.notNull()
			.references(() => positionConsent.id, { onDelete: "cascade" }),
		latitude: doublePrecision("latitude").notNull(),
		longitude: doublePrecision("longitude").notNull(),
		accuracyMeters: doublePrecision("accuracy_meters").notNull(),
		/** When the device determined the position (a cached fix may predate the event). */
		fixedAt: timestamp("fixed_at").notNull(),
		/** The clock event's instant: when the position was recorded with it. */
		capturedAt: timestamp("captured_at").notNull(),
		/** `capturedAt` + the organization's retention days at capture time. */
		purgeAt: timestamp("purge_at").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("positionStamp_timeEntryId_idx").on(table.timeEntryId),
		index("positionStamp_org_employee_idx").on(table.organizationId, table.employeeId),
		index("positionStamp_purgeAt_idx").on(table.purgeAt),
		check(
			"position_stamp_coordinates_check",
			sql`${table.latitude} between -90 and 90 and ${table.longitude} between -180 and 180`,
		),
		check(
			"position_stamp_accuracy_check",
			sql`${table.accuracyMeters} >= 0 and ${table.accuracyMeters} < 'Infinity'::float8`,
		),
		check("position_stamp_purge_check", sql`${table.purgeAt} > ${table.capturedAt}`),
		foreignKey({
			name: "position_stamp_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
	],
);

export const POSITION_STAMP_ACCESS_KINDS = ["work_period_detail", "data_export"] as const;
export type PositionStampAccessKind = (typeof POSITION_STAMP_ACCESS_KINDS)[number];

/**
 * Position stamp access log (#831, spec #766, decision D4): one entry each time
 * someone other than the employee is shown stamps, either on a work period's
 * detail ("Show positions") or in an export containing stamps (#835). The
 * employees covered are the entry's subjects. No position is stored here, so
 * the stamp purge never touches the log.
 *
 * Entries are append-only: a trigger refuses every update except the
 * `ON DELETE SET NULL` of a deleted viewer's user id, and every delete except
 * parent-deletion cascades and the retention cleanup of entries older than the
 * audit-log lifetime (spec #766, `deletePositionRecordsPastAuditLifetime`).
 */
export const positionStampAccessLog = pgTable(
	"position_stamp_access_log",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		/** Who was shown the stamps; null once that user is deleted. */
		viewerUserId: text("viewer_user_id").references(() => user.id, { onDelete: "set null" }),
		kind: text("kind").$type<PositionStampAccessKind>().notNull(),
		/** The work periods shown, for `work_period_detail`. */
		workPeriodIds: uuid("work_period_ids").array().default(sql`'{}'::uuid[]`).notNull(),
		/** The export that contained stamps, for `data_export`. */
		exportId: text("export_id"),
		accessedAt: timestamp("accessed_at").notNull(),
	},
	(table) => [
		unique("positionStampAccessLog_id_organizationId_idx").on(table.id, table.organizationId),
		index("positionStampAccessLog_org_accessedAt_idx").on(table.organizationId, table.accessedAt),
		index("positionStampAccessLog_viewerUserId_idx").on(table.viewerUserId),
		check(
			"position_stamp_access_log_kind_check",
			sql`(${table.kind} = 'work_period_detail' and cardinality(${table.workPeriodIds}) >= 1 and ${table.exportId} is null)
			or (${table.kind} = 'data_export' and ${table.exportId} is not null)`,
		),
	],
);

/** The employees whose stamps one access-log entry covers. */
export const positionStampAccessLogSubject = pgTable(
	"position_stamp_access_log_subject",
	{
		accessLogId: uuid("access_log_id").notNull(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
	},
	(table) => [
		primaryKey({
			name: "position_stamp_access_log_subject_pk",
			columns: [table.accessLogId, table.employeeId],
		}),
		index("positionStampAccessLogSubject_org_employee_idx").on(
			table.organizationId,
			table.employeeId,
		),
		foreignKey({
			name: "position_stamp_access_log_subject_log_fk",
			columns: [table.accessLogId, table.organizationId],
			foreignColumns: [positionStampAccessLog.id, positionStampAccessLog.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "position_stamp_access_log_subject_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
	],
);

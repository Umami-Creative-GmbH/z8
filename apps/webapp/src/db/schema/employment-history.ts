import { type SQL, sql } from "drizzle-orm";
import {
	type AnyPgColumn,
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
import {
	type ArbzgScope,
	type BalanceMode,
	contractChangeBatchItem,
	contractTemplateVersion,
	type EmploymentProfile,
	type EmploymentTermAgreementKind,
	type OnCallHoursKind,
	type PresenceOverride,
	type ScheduleMode,
	type ScheduleSource,
} from "./contract";
import { employeeEmploymentPeriod } from "./employee-lifecycle";
import {
	contractTypeEnum,
	dayOfWeekEnum,
	employmentReviewStateEnum,
	employmentStatusEnum,
	workModelEnum,
} from "./enums";
import { employee } from "./organization";
import { currentTimestamp } from "./timestamp";
import { workPolicy } from "./work-policy";

export const employeeEmploymentHistory = pgTable(
	"employee_employment_history",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		/** Employment stint these terms belong to; null only before legacy backfill. */
		employmentPeriodId: uuid("employment_period_id"),
		validFrom: timestamp("valid_from").notNull(),
		validUntil: timestamp("valid_until"),
		/** Canonical calendar-date interval [validFromDate, validUntilDate) (0320/0323). */
		validFromDate: date("valid_from_date", { mode: "string" }).notNull(),
		validUntilDate: date("valid_until_date", { mode: "string" }),
		status: employmentStatusEnum("status").default("active").notNull(),
		contractType: contractTypeEnum("contract_type").default("fixed").notNull(),
		weeklyContractMinutes: integer("weekly_contract_minutes"),
		probationStartsOn: timestamp("probation_starts_on", { mode: "date" }),
		probationEndsOn: timestamp("probation_ends_on", { mode: "date" }),
		workModel: workModelEnum("work_model"),
		workPolicyId: uuid("work_policy_id").references(() => workPolicy.id, { onDelete: "set null" }),
		/** Operational divergence columns (null / 'inherit' means live-inherited from org/team default). */
		scheduleMode: text("schedule_mode").$type<ScheduleMode>(),
		presenceOverride: text("presence_override").$type<PresenceOverride>(),
		balanceMode: text("balance_mode").$type<BalanceMode>(),
		scheduleSource: text("schedule_source").$type<ScheduleSource>(),
		sourceTemplateVersionId: uuid("source_template_version_id"),
		sourceBatchItemId: uuid("source_batch_item_id"),
		/** Employee-owned legal & statutory classification terms. */
		employmentProfile: text("employment_profile")
			.$type<EmploymentProfile>()
			.default("regular")
			.notNull(),
		arbzgScope: text("arbzg_scope").$type<ArbzgScope>().default("standard").notNull(),
		/** Employee-owned § 12 TzBfG on-call terms. */
		onCallHoursKind: text("on_call_hours_kind").$type<OnCallHoursKind>(),
		onCallWeeklyMinutes: integer("on_call_weekly_minutes"),
		onCallDailyMinutes: integer("on_call_daily_minutes"),
		/** True on pre-migration confirmed rows preserved intact until admin opts into live inheritance. */
		migratedLegacyTerms: boolean("migrated_legacy_terms").default(false).notNull(),
		/** The hourly wage of hourly terms; fixed terms carry none. */
		hourlyRate: numeric("hourly_rate", { precision: 10, scale: 2, mode: "number" }),
		currency: text("currency").default("EUR").notNull(),
		changeReason: text("change_reason"),
		reviewState: employmentReviewStateEnum("review_state").default("draft").notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedBy: text("updated_by").references(() => user.id),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		unique("employee_employment_history_id_org_uidx").on(table.id, table.organizationId),
		index("employeeEmploymentHistory_employeeId_idx").on(table.employeeId),
		index("employeeEmploymentHistory_organizationId_idx").on(table.organizationId),
		index("employeeEmploymentHistory_employee_validFrom_idx").on(table.employeeId, table.validFrom),
		index("employeeEmploymentHistory_employee_reviewState_idx").on(
			table.employeeId,
			table.reviewState,
		),
		index("employeeEmploymentHistory_workPolicyId_idx").on(table.workPolicyId),
		index("employeeEmploymentHistory_period_idx").on(
			table.organizationId,
			table.employmentPeriodId,
		),
		foreignKey({
			name: "employeeEmploymentHistory_period_fk",
			columns: [table.employmentPeriodId, table.organizationId, table.employeeId],
			foreignColumns: [
				employeeEmploymentPeriod.id,
				employeeEmploymentPeriod.organizationId,
				employeeEmploymentPeriod.employeeId,
			],
		}),
		foreignKey({
			name: "employee_employment_history_template_version_fk",
			columns: [table.sourceTemplateVersionId, table.organizationId],
			foreignColumns: [contractTemplateVersion.id, contractTemplateVersion.organizationId],
		}).onDelete("no action"),
		foreignKey({
			name: "employee_employment_history_batch_item_fk",
			columns: [table.sourceBatchItemId, table.organizationId],
			foreignColumns: [contractChangeBatchItem.id, contractChangeBatchItem.organizationId],
		}).onDelete("no action"),
		check(
			"employee_employment_history_schedule_mode_check",
			sql`"schedule_mode" IS NULL OR "schedule_mode" IN ('inherit', 'policy', 'hours_only', 'custom_days')`,
		),
		check(
			"employee_employment_history_presence_override_check",
			sql`"presence_override" IS NULL OR "presence_override" IN ('inherit', 'exempt', 'require_onsite')`,
		),
		check(
			"employee_employment_history_balance_mode_check",
			sql`"balance_mode" IS NULL OR "balance_mode" IN ('tracked', 'trust_based')`,
		),
		check(
			"employee_employment_history_schedule_source_check",
			sql`"schedule_source" IS NULL OR "schedule_source" IN ('policy', 'published_shifts', 'on_call')`,
		),
		check(
			"employee_employment_history_profile_check",
			sql`"employment_profile" IN ('regular', 'minijob', 'short_term', 'working_student', 'apprentice')`,
		),
		check(
			"employee_employment_history_arbzg_scope_check",
			sql`"arbzg_scope" IN ('standard', 'executive_exempt')`,
		),
		check(
			"employee_employment_history_on_call_check",
			sql`((("schedule_source" IS DISTINCT FROM 'on_call' AND "on_call_hours_kind" IS NULL AND "on_call_weekly_minutes" IS NULL AND "on_call_daily_minutes" IS NULL) OR ("schedule_source" = 'on_call' AND "on_call_hours_kind" IN ('exact', 'minimum', 'maximum', 'unspecified') AND (("on_call_hours_kind" = 'unspecified' AND "on_call_weekly_minutes" IS NULL) OR ("on_call_hours_kind" IN ('exact', 'minimum', 'maximum') AND "on_call_weekly_minutes" BETWEEN 1 AND 10080)) AND ("on_call_daily_minutes" IS NULL OR "on_call_daily_minutes" BETWEEN 1 AND 1440))) IS TRUE)`,
		),
		check(
			"employee_employment_history_date_range_check",
			sql`"valid_until_date" IS NULL OR "valid_until_date" >= "valid_from_date"`,
		),
		check(
			"employee_employment_history_weekly_min_check",
			sql`"weekly_contract_minutes" IS NULL OR ("weekly_contract_minutes" >= 0 AND "weekly_contract_minutes" <= 10080)`,
		),
		uniqueIndex("employeeEmploymentHistory_source_batch_item_uidx")
			.on(table.sourceBatchItemId)
			.where(sql`"source_batch_item_id" IS NOT NULL`),
	],
);

/** Normalized custom working days for an employee's employment terms row (integer minutes per day). */
export const employeeEmploymentHistoryDay = pgTable(
	"employee_employment_history_day",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employmentHistoryId: uuid("employment_history_id").notNull(),
		dayOfWeek: dayOfWeekEnum("day_of_week").notNull(),
		minutesPerDay: integer("minutes_per_day").notNull(),
		isWorkDay: boolean("is_work_day").default(true).notNull(),
		latestClockIn: text("latest_clock_in"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		unique("employeeEmploymentHistoryDay_history_day_unique").on(
			table.employmentHistoryId,
			table.dayOfWeek,
		),
		index("employeeEmploymentHistoryDay_org_history_idx").on(
			table.organizationId,
			table.employmentHistoryId,
		),
		foreignKey({
			name: "employee_employment_history_day_history_fk",
			columns: [table.employmentHistoryId, table.organizationId],
			foreignColumns: [employeeEmploymentHistory.id, employeeEmploymentHistory.organizationId],
		}).onDelete("cascade"),
		check(
			"employee_employment_history_day_minutes_check",
			sql`"minutes_per_day" >= 0 AND "minutes_per_day" <= 1440`,
		),
		check(
			"employee_employment_history_day_workday_minutes_check",
			sql`"is_work_day" OR "minutes_per_day" = 0`,
		),
		check(
			"employee_employment_history_day_latest_clock_in_check",
			sql`"latest_clock_in" IS NULL OR "latest_clock_in" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
		),
	],
);

/**
 * Permanent or fixed-term employment agreement forming a strict single-root
 * linear extension chain per employment period.
 */
export const employmentTermAgreement = pgTable(
	"employment_term_agreement",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		employmentPeriodId: uuid("employment_period_id").notNull(),
		sequenceNumber: integer("sequence_number").notNull(),
		supersedesId: uuid("supersedes_id"),
		previousSequenceNumber: integer("previous_sequence_number").generatedAlwaysAs(
			(): SQL =>
				sql`CASE WHEN ${employmentTermAgreement.sequenceNumber} > 1 THEN ${employmentTermAgreement.sequenceNumber} - 1 ELSE NULL END`,
		),
		kind: text("kind").$type<EmploymentTermAgreementKind>().notNull(),
		startsOn: date("starts_on", { mode: "string" }).notNull(),
		endsOn: date("ends_on", { mode: "string" }),
		reason: text("reason"),
		notes: text("notes"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		unique("employment_term_agreement_period_seq_unique").on(
			table.employmentPeriodId,
			table.sequenceNumber,
		),
		unique("employment_term_agreement_chain_target_unique").on(
			table.id,
			table.organizationId,
			table.employeeId,
			table.employmentPeriodId,
			table.sequenceNumber,
		),
		uniqueIndex("employmentTermAgreement_supersedes_uidx")
			.on(table.supersedesId)
			.where(sql`"supersedes_id" IS NOT NULL`),
		index("employmentTermAgreement_org_employee_idx").on(table.organizationId, table.employeeId),
		index("employmentTermAgreement_period_idx").on(table.organizationId, table.employmentPeriodId),
		foreignKey({
			name: "employment_term_agreement_period_fk",
			columns: [table.employmentPeriodId, table.organizationId, table.employeeId],
			foreignColumns: [
				employeeEmploymentPeriod.id,
				employeeEmploymentPeriod.organizationId,
				employeeEmploymentPeriod.employeeId,
			],
		}).onDelete("cascade"),
		foreignKey({
			name: "employment_term_agreement_supersedes_fk",
			columns: [
				table.supersedesId,
				table.organizationId,
				table.employeeId,
				table.employmentPeriodId,
				table.previousSequenceNumber,
			],
			foreignColumns: [
				table.id as AnyPgColumn,
				table.organizationId as AnyPgColumn,
				table.employeeId as AnyPgColumn,
				table.employmentPeriodId as AnyPgColumn,
				table.sequenceNumber as AnyPgColumn,
			],
		}).onDelete("no action"),
		check("employment_term_agreement_seq_check", sql`"sequence_number" >= 1`),
		check(
			"employment_term_agreement_root_check",
			sql`("sequence_number" = 1) = ("supersedes_id" IS NULL)`,
		),
		check("employment_term_agreement_kind_check", sql`"kind" IN ('permanent', 'fixed_term')`),
		check(
			"employment_term_agreement_kind_ends_reason_check",
			sql`((("kind" = 'permanent' AND "ends_on" IS NULL AND "reason" IS NULL) OR ("kind" = 'fixed_term' AND "ends_on" IS NOT NULL AND "ends_on" >= "starts_on")) IS TRUE)`,
		),
	],
);

export type EmployeeEmploymentHistory = typeof employeeEmploymentHistory.$inferSelect;
export type NewEmployeeEmploymentHistory = typeof employeeEmploymentHistory.$inferInsert;
export type EmployeeEmploymentHistoryDay = typeof employeeEmploymentHistoryDay.$inferSelect;
export type EmploymentTermAgreement = typeof employmentTermAgreement.$inferSelect;
export type NewEmploymentTermAgreement = typeof employmentTermAgreement.$inferInsert;

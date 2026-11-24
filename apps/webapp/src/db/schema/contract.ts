import { type SQL, sql } from "drizzle-orm";
import {
	boolean,
	check,
	date,
	foreignKey,
	index,
	integer,
	jsonb,
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
	balanceModes,
	type ContractChangeBatchExecutionMode,
	type ContractChangeBatchItemStatus,
	type ContractChangeBatchOperationKind,
	type ContractChangeBatchStatus,
	type ContractDefaultScope,
	type ContractTemplateKind,
	contractChangeBatchExecutionModes,
	contractChangeBatchItemStatuses,
	contractChangeBatchOperationKinds,
	contractChangeBatchStatuses,
	contractDefaultScopes,
	contractTemplateKinds,
	type EmploymentProfile,
	type OnCallHoursKind,
	type PresenceOverride,
	presenceOverrides,
	type ScheduleSource,
	scheduleSources,
	type TemplateScheduleMode,
	templateScheduleModes,
} from "./contract-types";
import { contractTypeEnum, dayOfWeekEnum, workModelEnum } from "./enums";
import { employee, team } from "./organization";
import { currentTimestamp } from "./timestamp";
import { workPolicy } from "./work-policy";

export type {
	ArbzgScope,
	BalanceMode,
	ContractChangeBatchExecutionMode,
	ContractChangeBatchItemStatus,
	ContractChangeBatchOperationKind,
	ContractChangeBatchStatus,
	ContractDefaultScope,
	ContractMigrationConflictKind,
	ContractMigrationConflictStatus,
	ContractTemplateKind,
	EmploymentProfile,
	EmploymentTermAgreementKind,
	OnCallHoursKind,
	PresenceOverride,
	ScheduleMode,
	ScheduleSource,
	TemplateScheduleMode,
	WorkPolicyAssignmentSourceKind,
} from "./contract-types";

type JsonObject = Record<string, unknown>;

function textIn(column: string, values: readonly string[]) {
	return sql.raw(`"${column}" IN (${values.map((value) => `'${value}'`).join(", ")})`);
}

/**
 * Reusable contract template (and internal default-backing template container).
 * Editing a template creates a new immutable `contract_template_version`.
 */
export const contractTemplate = pgTable(
	"contract_template",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		description: text("description"),
		kind: text("kind").$type<ContractTemplateKind>().default("template").notNull(),
		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		unique("contract_template_id_org_unique").on(table.id, table.organizationId),
		index("contractTemplate_organizationId_idx").on(table.organizationId),
		uniqueIndex("contractTemplate_org_name_idx")
			.on(table.organizationId, table.name)
			.where(sql`"kind" = 'template' AND "is_active" = true`),
		check("contract_template_kind_check", textIn("kind", contractTemplateKinds)),
	],
);

/**
 * Immutable versioned contract template snapshot.
 * `is_default_eligible` is a stored generated column prohibiting inherited `on_call` defaults.
 */
export const contractTemplateVersion = pgTable(
	"contract_template_version",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		templateId: uuid("template_id").notNull(),
		versionNumber: integer("version_number").notNull(),
		workPolicyId: uuid("work_policy_id"),
		weeklyContractMinutes: integer("weekly_contract_minutes"),
		scheduleMode: text("schedule_mode").$type<TemplateScheduleMode>().default("policy").notNull(),
		workModel: workModelEnum("work_model"),
		presenceOverride: text("presence_override")
			.$type<PresenceOverride>()
			.default("inherit")
			.notNull(),
		balanceMode: text("balance_mode").$type<BalanceMode>().default("tracked").notNull(),
		scheduleSource: text("schedule_source").$type<ScheduleSource>().default("policy").notNull(),
		isDefaultEligible: boolean("is_default_eligible")
			.notNull()
			.generatedAlwaysAs(
				(): SQL => sql`${contractTemplateVersion.scheduleSource} IN ('policy', 'published_shifts')`,
			),
		defaultContractType: contractTypeEnum("default_contract_type"),
		defaultEmploymentProfile: text("default_employment_profile").$type<EmploymentProfile>(),
		defaultArbzgScope: text("default_arbzg_scope").$type<ArbzgScope>(),
		defaultOnCallHoursKind: text("default_on_call_hours_kind").$type<OnCallHoursKind>(),
		defaultOnCallWeeklyMinutes: integer("default_on_call_weekly_minutes"),
		defaultOnCallDailyMinutes: integer("default_on_call_daily_minutes"),
		defaultHourlyRate: numeric("default_hourly_rate", {
			precision: 10,
			scale: 2,
			mode: "number",
		}),
		defaultCurrency: text("default_currency"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		unique("contract_template_version_id_org_unique").on(table.id, table.organizationId),
		unique("contract_template_version_id_org_eligible_unique").on(
			table.id,
			table.organizationId,
			table.isDefaultEligible,
		),
		unique("contract_template_version_template_ver_unique").on(
			table.templateId,
			table.versionNumber,
		),
		index("contractTemplateVersion_org_template_idx").on(table.organizationId, table.templateId),
		foreignKey({
			name: "contract_template_version_template_fk",
			columns: [table.templateId, table.organizationId],
			foreignColumns: [contractTemplate.id, contractTemplate.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "contract_template_version_work_policy_fk",
			columns: [table.workPolicyId, table.organizationId],
			foreignColumns: [workPolicy.id, workPolicy.organizationId],
		}).onDelete("no action"),
		check("contract_template_version_ver_check", sql`"version_number" >= 1`),
		check(
			"contract_template_version_weekly_min_check",
			sql`"weekly_contract_minutes" IS NULL OR ("weekly_contract_minutes" >= 0 AND "weekly_contract_minutes" <= 10080)`,
		),
		check(
			"contract_template_version_schedule_mode_check",
			textIn("schedule_mode", templateScheduleModes),
		),
		check(
			"contract_template_version_presence_override_check",
			textIn("presence_override", presenceOverrides),
		),
		check("contract_template_version_balance_mode_check", textIn("balance_mode", balanceModes)),
		check(
			"contract_template_version_schedule_source_check",
			textIn("schedule_source", scheduleSources),
		),
		check(
			"contract_template_version_profile_check",
			sql`"default_employment_profile" IS NULL OR "default_employment_profile" IN ('regular', 'minijob', 'short_term', 'working_student', 'apprentice')`,
		),
		check(
			"contract_template_version_arbzg_check",
			sql`"default_arbzg_scope" IS NULL OR "default_arbzg_scope" IN ('standard', 'executive_exempt')`,
		),
		check(
			"contract_template_version_on_call_check",
			sql`((("schedule_source" IS DISTINCT FROM 'on_call' AND "default_on_call_hours_kind" IS NULL AND "default_on_call_weekly_minutes" IS NULL AND "default_on_call_daily_minutes" IS NULL) OR ("schedule_source" = 'on_call' AND ("default_on_call_hours_kind" IS NULL OR ("default_on_call_hours_kind" = 'unspecified' AND "default_on_call_weekly_minutes" IS NULL) OR ("default_on_call_hours_kind" IN ('exact', 'minimum', 'maximum') AND "default_on_call_weekly_minutes" BETWEEN 1 AND 10080)) AND ("default_on_call_daily_minutes" IS NULL OR "default_on_call_daily_minutes" BETWEEN 1 AND 1440))) IS TRUE)`,
		),
	],
);

/** Normalized custom working days for a contract template version (integer minutes per day). */
export const contractTemplateVersionDay = pgTable(
	"contract_template_version_day",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		templateVersionId: uuid("template_version_id").notNull(),
		dayOfWeek: dayOfWeekEnum("day_of_week").notNull(),
		minutesPerDay: integer("minutes_per_day").notNull(),
		isWorkDay: boolean("is_work_day").default(true).notNull(),
		latestClockIn: text("latest_clock_in"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		unique("contractTemplateVersionDay_version_day_unique").on(
			table.templateVersionId,
			table.dayOfWeek,
		),
		index("contractTemplateVersionDay_org_version_idx").on(
			table.organizationId,
			table.templateVersionId,
		),
		foreignKey({
			name: "contract_template_version_day_version_fk",
			columns: [table.templateVersionId, table.organizationId],
			foreignColumns: [contractTemplateVersion.id, contractTemplateVersion.organizationId],
		}).onDelete("cascade"),
		check(
			"contract_template_version_day_minutes_check",
			sql`"minutes_per_day" >= 0 AND "minutes_per_day" <= 1440`,
		),
		check(
			"contract_template_version_day_workday_minutes_check",
			sql`"is_work_day" OR "minutes_per_day" = 0`,
		),
		check(
			"contract_template_version_day_latest_clock_in_check",
			sql`"latest_clock_in" IS NULL OR "latest_clock_in" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
		),
	],
);

/**
 * Date-effective organization or primary-team default contract.
 * Enforces `require_default_eligible = true` via composite FK to `contract_template_version`.
 */
export const contractDefault = pgTable(
	"contract_default",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		scope: text("scope").$type<ContractDefaultScope>().notNull(),
		teamId: uuid("team_id"),
		templateVersionId: uuid("template_version_id").notNull(),
		requireDefaultEligible: boolean("require_default_eligible").default(true).notNull(),
		effectiveFromDate: date("effective_from_date", { mode: "string" }).notNull(),
		effectiveUntilDate: date("effective_until_date", { mode: "string" }),
		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		unique("contract_default_id_org_unique").on(table.id, table.organizationId),
		index("contractDefault_org_scope_date_idx").on(
			table.organizationId,
			table.scope,
			table.teamId,
			table.effectiveFromDate,
		),
		uniqueIndex("contractDefault_org_start_uidx")
			.on(table.organizationId, table.effectiveFromDate)
			.where(sql`"scope" = 'organization' AND "is_active" = true`),
		uniqueIndex("contractDefault_team_start_uidx")
			.on(table.organizationId, table.teamId, table.effectiveFromDate)
			.where(sql`"scope" = 'team' AND "is_active" = true`),
		foreignKey({
			name: "contract_default_team_fk",
			columns: [table.teamId, table.organizationId],
			foreignColumns: [team.id, team.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "contract_default_template_version_fk",
			columns: [table.templateVersionId, table.organizationId, table.requireDefaultEligible],
			foreignColumns: [
				contractTemplateVersion.id,
				contractTemplateVersion.organizationId,
				contractTemplateVersion.isDefaultEligible,
			],
		}).onDelete("no action"),
		check("contract_default_scope_check", textIn("scope", contractDefaultScopes)),
		check("contract_default_scope_team_check", sql`("scope" = 'team') = ("team_id" IS NOT NULL)`),
		check("contract_default_require_eligible_check", sql`"require_default_eligible" = true`),
		check(
			"contract_default_date_range_check",
			sql`"effective_until_date" IS NULL OR "effective_until_date" > "effective_from_date"`,
		),
	],
);

/** Effective-dated statutory reference thresholds (Milestone 1 previews & Milestone 2 calculators). */
export const statutoryThreshold = pgTable(
	"statutory_threshold",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").references(() => organization.id, {
			onDelete: "cascade",
		}),
		countryCode: text("country_code").notNull(),
		thresholdKey: text("threshold_key").notNull(),
		effectiveFromDate: date("effective_from_date", { mode: "string" }).notNull(),
		effectiveUntilDate: date("effective_until_date", { mode: "string" }),
		numericValue: numeric("numeric_value", { precision: 12, scale: 2, mode: "number" }),
		integerValue: integer("integer_value"),
		currency: text("currency"),
		unit: text("unit"),
		/** Statute the value comes from, e.g. `§ 8 Abs. 1a SGB IV` (#1988). */
		legalReference: text("legal_reference"),
		notes: text("notes"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("statutoryThreshold_system_key_date_uidx")
			.on(table.countryCode, table.thresholdKey, table.effectiveFromDate)
			.where(sql`"organization_id" IS NULL`),
		uniqueIndex("statutoryThreshold_org_key_date_uidx")
			.on(table.organizationId, table.countryCode, table.thresholdKey, table.effectiveFromDate)
			.where(sql`"organization_id" IS NOT NULL`),
		index("statutoryThreshold_lookup_idx").on(
			table.countryCode,
			table.thresholdKey,
			table.effectiveFromDate,
		),
		check(
			"statutory_threshold_date_range_check",
			sql`"effective_until_date" IS NULL OR "effective_until_date" > "effective_from_date"`,
		),
		check(
			"statutory_threshold_value_check",
			sql`"numeric_value" IS NOT NULL OR "integer_value" IS NOT NULL`,
		),
	],
);

/** Durable idempotent batch ledger for bulk contract updates and CSV imports. */
export const contractChangeBatch = pgTable(
	"contract_change_batch",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		requestId: uuid("request_id").notNull(),
		requestFingerprint: text("request_fingerprint").notNull(),
		operationKind: text("operation_kind").$type<ContractChangeBatchOperationKind>().notNull(),
		executionMode: text("execution_mode").$type<ContractChangeBatchExecutionMode>().notNull(),
		status: text("status").$type<ContractChangeBatchStatus>().default("pending").notNull(),
		totalItems: integer("total_items").default(0).notNull(),
		completedItems: integer("completed_items").default(0).notNull(),
		failedItems: integer("failed_items").default(0).notNull(),
		skippedItems: integer("skipped_items").default(0).notNull(),
		payload: jsonb("payload").$type<JsonObject>().default({}).notNull(),
		result: jsonb("result").$type<JsonObject>(),
		leaseToken: uuid("lease_token"),
		leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
		heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
		attemptCount: integer("attempt_count").default(0).notNull(),
		lastError: text("last_error"),
		startedAt: timestamp("started_at", { withTimezone: true }),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		unique("contract_change_batch_id_org_unique").on(table.id, table.organizationId),
		uniqueIndex("contractChangeBatch_org_request_uidx").on(table.organizationId, table.requestId),
		index("contractChangeBatch_claimable_idx")
			.on(table.status, table.leaseExpiresAt, table.createdAt, table.id)
			.where(sql`"status" IN ('pending', 'running')`),
		index("contractChangeBatch_org_created_idx").on(table.organizationId, table.createdAt),
		check(
			"contract_change_batch_operation_kind_check",
			textIn("operation_kind", contractChangeBatchOperationKinds),
		),
		check(
			"contract_change_batch_execution_mode_check",
			textIn("execution_mode", contractChangeBatchExecutionModes),
		),
		check("contract_change_batch_status_check", textIn("status", contractChangeBatchStatuses)),
		check(
			"contract_change_batch_counts_check",
			sql`"total_items" >= 0 AND "completed_items" >= 0 AND "failed_items" >= 0 AND "skipped_items" >= 0 AND "attempt_count" >= 0`,
		),
	],
);

/** Per-employee item in a durable contract change batch with operation deduplication key. */
export const contractChangeBatchItem = pgTable(
	"contract_change_batch_item",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		batchId: uuid("batch_id").notNull(),
		employeeId: uuid("employee_id").notNull(),
		itemIndex: integer("item_index").notNull(),
		operationDedupeKey: text("operation_dedupe_key").notNull(),
		status: text("status").$type<ContractChangeBatchItemStatus>().default("pending").notNull(),
		payload: jsonb("payload").$type<JsonObject>().default({}).notNull(),
		result: jsonb("result").$type<JsonObject>(),
		errorCode: text("error_code"),
		errorMessage: text("error_message"),
		attemptCount: integer("attempt_count").default(0).notNull(),
		processedAt: timestamp("processed_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		unique("contract_change_batch_item_id_org_unique").on(table.id, table.organizationId),
		uniqueIndex("contractChangeBatchItem_batch_employee_uidx").on(table.batchId, table.employeeId),
		uniqueIndex("contractChangeBatchItem_org_dedupe_uidx").on(
			table.organizationId,
			table.operationDedupeKey,
		),
		index("contractChangeBatchItem_claimable_idx")
			.on(table.batchId, table.employeeId)
			.where(sql`"status" IN ('pending', 'running')`),
		index("contractChangeBatchItem_org_status_idx").on(table.organizationId, table.status),
		foreignKey({
			name: "contract_change_batch_item_batch_fk",
			columns: [table.batchId, table.organizationId],
			foreignColumns: [contractChangeBatch.id, contractChangeBatch.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "contract_change_batch_item_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		check(
			"contract_change_batch_item_status_check",
			textIn("status", contractChangeBatchItemStatuses),
		),
		check(
			"contract_change_batch_item_index_attempt_check",
			sql`"item_index" >= 0 AND "attempt_count" >= 0`,
		),
	],
);

export type ContractTemplate = typeof contractTemplate.$inferSelect;
export type NewContractTemplate = typeof contractTemplate.$inferInsert;
export type ContractTemplateVersion = typeof contractTemplateVersion.$inferSelect;
export type NewContractTemplateVersion = typeof contractTemplateVersion.$inferInsert;
export type ContractTemplateVersionDay = typeof contractTemplateVersionDay.$inferSelect;
export type ContractDefault = typeof contractDefault.$inferSelect;
export type StatutoryThreshold = typeof statutoryThreshold.$inferSelect;
export type ContractChangeBatch = typeof contractChangeBatch.$inferSelect;
export type ContractChangeBatchItem = typeof contractChangeBatchItem.$inferSelect;

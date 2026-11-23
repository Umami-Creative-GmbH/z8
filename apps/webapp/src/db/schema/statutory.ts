import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	boolean,
	check,
	date,
	foreignKey,
	index,
	integer,
	pgTable,
	text,
	time,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { employee } from "./organization";

// German statutory foundation (#1988, spec #1934). Migration: 0329_statutory_foundation.sql.
// Constraint and foreign-key names match the migration so `drizzle-kit push` keeps them. What
// lives in SQL only (baseline seed, guard triggers, `btree_gist`, the overlap exclusions on
// `statutory_threshold`, study periods and apprentice releases) is re-applied after push by
// `pnpm run db:install-statutory-foundation`, which `db:push` runs.

export const employeeStatutoryOffsetKinds = [
	"external_minijob_monthly_earnings",
	"prior_short_term_work_days",
	"prior_short_term_months",
	"prior_working_student_over_20h_weeks",
] as const;
export type EmployeeStatutoryOffsetKind = (typeof employeeStatutoryOffsetKinds)[number];

export const employeeStudyPeriodKinds = ["lecture_free"] as const;
export type EmployeeStudyPeriodKind = (typeof employeeStudyPeriodKinds)[number];

export const apprenticeReleaseKinds = [
	"vocational_school_day",
	"vocational_school_block_week",
	"exam_day",
	"pre_exam_day",
] as const;
export type ApprenticeReleaseKind = (typeof apprenticeReleaseKinds)[number];

function textIn(column: string, values: readonly string[]) {
	return sql.raw(`"${column}" IN (${values.map((value) => `'${value}'`).join(", ")})`);
}

/** A voided record needs who voided it and why. */
const voidCheckSql = sql`("voided_at" IS NULL) = ("voided_by" IS NULL) AND ("voided_at" IS NULL OR length(btrim(coalesce("void_reason", ''))) > 0)`;

/** Org-admin statutory warning tiers and the optional JArbSchG shift-publish block. No row = defaults. */
export const organizationStatutoryPreference = pgTable(
	"organization_statutory_preference",
	{
		organizationId: text("organization_id").primaryKey(),
		warningThresholdPercent: integer("warning_threshold_percent").default(80).notNull(),
		criticalThresholdPercent: integer("critical_threshold_percent").default(95).notNull(),
		blockJarbschgShiftPublish: boolean("block_jarbschg_shift_publish").default(false).notNull(),
		updatedBy: text("updated_by"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		foreignKey({
			name: "organization_statutory_preference_organization_fk",
			columns: [table.organizationId],
			foreignColumns: [organization.id],
		}).onDelete("cascade"),
		foreignKey({
			name: "organization_statutory_preference_updated_by_fk",
			columns: [table.updatedBy],
			foreignColumns: [user.id],
		}).onDelete("set null"),
		check(
			"organization_statutory_preference_percent_check",
			sql`"warning_threshold_percent" BETWEEN 1 AND 100 AND "critical_threshold_percent" BETWEEN 1 AND 100 AND "warning_threshold_percent" < "critical_threshold_percent"`,
		),
	],
);

const contextColumns = {
	id: uuid("id").defaultRandom().primaryKey(),
	organizationId: text("organization_id").notNull(),
	employeeId: uuid("employee_id").notNull(),
};

const auditColumns = {
	createdBy: text("created_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	voidedAt: timestamp("voided_at", { withTimezone: true }),
	voidedBy: text("voided_by"),
	voidReason: text("void_reason"),
};

/** The four foreign keys every per-employee statutory context table has, named as in SQL. */
function contextForeignKeys(
	prefix: string,
	table: {
		organizationId: AnyPgColumn;
		employeeId: AnyPgColumn;
		createdBy: AnyPgColumn;
		voidedBy: AnyPgColumn;
	},
) {
	return [
		foreignKey({
			name: `${prefix}_organization_fk`,
			columns: [table.organizationId],
			foreignColumns: [organization.id],
		}).onDelete("cascade"),
		foreignKey({
			name: `${prefix}_employee_fk`,
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: `${prefix}_created_by_fk`,
			columns: [table.createdBy],
			foreignColumns: [user.id],
		}),
		foreignKey({
			name: `${prefix}_voided_by_fk`,
			columns: [table.voidedBy],
			foreignColumns: [user.id],
		}),
	];
}

/**
 * External / prior-employment statutory offsets. `valid_until_date` is exclusive.
 * - `external_minijob_monthly_earnings`: `amount_cents` + `currency` for every calendar month in
 *   `[valid_from_date, valid_until_date)`; both dates are the first of a month, so a month either
 *   counts in full or not at all.
 * - `prior_short_term_*`: `count_value` for exactly one calendar year (Jan 1 .. next Jan 1).
 * - `prior_working_student_over_20h_weeks`: `count_value` consecutive Monday–Sunday weeks above
 *   20 h, starting on the Monday `valid_from_date` (`valid_until_date` = start + 7 × count), so a
 *   rolling 12-month window can age each week out exactly.
 */
export const employeeStatutoryOffset = pgTable(
	"employee_statutory_offset",
	{
		...contextColumns,
		offsetKind: text("offset_kind").$type<EmployeeStatutoryOffsetKind>().notNull(),
		validFromDate: date("valid_from_date", { mode: "string" }).notNull(),
		validUntilDate: date("valid_until_date", { mode: "string" }),
		amountCents: integer("amount_cents"),
		currency: text("currency"),
		countValue: integer("count_value"),
		sourceEmployer: text("source_employer"),
		note: text("note").notNull(),
		...auditColumns,
	},
	(table) => [
		index("employeeStatutoryOffset_lookup_idx").on(
			table.organizationId,
			table.employeeId,
			table.offsetKind,
			table.validFromDate,
		),
		...contextForeignKeys("employee_statutory_offset", table),
		check(
			"employee_statutory_offset_kind_check",
			textIn("offset_kind", employeeStatutoryOffsetKinds),
		),
		check(
			"employee_statutory_offset_date_range_check",
			sql`"valid_until_date" IS NULL OR "valid_until_date" > "valid_from_date"`,
		),
		check("employee_statutory_offset_note_check", sql`length(btrim("note")) > 0`),
		check("employee_statutory_offset_void_check", voidCheckSql),
		// coalesce: a CHECK that evaluates to NULL passes, so a missing count or end date must fail.
		check(
			"employee_statutory_offset_value_check",
			sql`coalesce(CASE "offset_kind"
				WHEN 'external_minijob_monthly_earnings' THEN
					"amount_cents" IS NOT NULL AND "amount_cents" >= 0
					AND "currency" IS NOT NULL AND "count_value" IS NULL
					AND extract(day FROM "valid_from_date") = 1
					AND ("valid_until_date" IS NULL OR extract(day FROM "valid_until_date") = 1)
				WHEN 'prior_short_term_work_days' THEN
					"count_value" BETWEEN 0 AND 366 AND "amount_cents" IS NULL
					AND date_trunc('year', "valid_from_date")::date = "valid_from_date"
					AND "valid_until_date" = ("valid_from_date" + interval '1 year')::date
				WHEN 'prior_short_term_months' THEN
					"count_value" BETWEEN 0 AND 12 AND "amount_cents" IS NULL
					AND date_trunc('year', "valid_from_date")::date = "valid_from_date"
					AND "valid_until_date" = ("valid_from_date" + interval '1 year')::date
				WHEN 'prior_working_student_over_20h_weeks' THEN
					"count_value" BETWEEN 1 AND 53 AND "amount_cents" IS NULL
					AND "valid_until_date" IS NOT NULL
					AND extract(isodow FROM "valid_from_date") = 1
					AND "valid_until_date" - "valid_from_date" = 7 * "count_value"
				ELSE false
			END, false)`,
		),
	],
);

/** Working-student lecture-free (semester break) intervals; `ends_on` is inclusive. */
export const employeeStudyPeriod = pgTable(
	"employee_study_period",
	{
		...contextColumns,
		periodKind: text("period_kind")
			.$type<EmployeeStudyPeriodKind>()
			.default("lecture_free")
			.notNull(),
		startsOn: date("starts_on", { mode: "string" }).notNull(),
		endsOn: date("ends_on", { mode: "string" }).notNull(),
		note: text("note"),
		...auditColumns,
	},
	(table) => [
		...contextForeignKeys("employee_study_period", table),
		check("employee_study_period_kind_check", textIn("period_kind", employeeStudyPeriodKinds)),
		check("employee_study_period_date_range_check", sql`"ends_on" >= "starts_on"`),
		check("employee_study_period_void_check", voidCheckSql),
	],
);

/** Apprentice vocational-school and exam release records (BBiG § 15 / JArbSchG § 9); `ends_on` inclusive. */
export const employeeApprenticeRelease = pgTable(
	"employee_apprentice_release",
	{
		...contextColumns,
		releaseKind: text("release_kind").$type<ApprenticeReleaseKind>().notNull(),
		startsOn: date("starts_on", { mode: "string" }).notNull(),
		endsOn: date("ends_on", { mode: "string" }).notNull(),
		/** School lessons on a vocational-school day (> 5 lessons credits a full day). */
		lessonCount: integer("lesson_count"),
		/**
		 * Planned school minutes per week of a block-release record (>= 25 h across >= 5 days), or
		 * an exam's participation time including breaks.
		 */
		schoolMinutes: integer("school_minutes"),
		/** When an exam starts (local wall time); with it, the exam day credits only its time. */
		examStartTime: time("exam_start_time"),
		/**
		 * When a short school day's lessons start and end (local wall time): shifts during them, and
		 * before lessons starting before 09:00, conflict with the release (§ 9 Abs. 1 JArbSchG,
		 * § 15 Abs. 1 BBiG). Its `school_minutes` hold the school time between them.
		 */
		schoolStartTime: time("school_start_time"),
		schoolEndTime: time("school_end_time"),
		/** On a pre-exam day: the exam it was released for. Voiding the exam voids it. */
		examReleaseId: uuid("exam_release_id"),
		/**
		 * On a release voided to make room for another (a school day for a pre-exam day, a pre-exam
		 * day for a full block day): that release. Voiding it restores this one, when its days are
		 * still free.
		 */
		supersededByReleaseId: uuid("superseded_by_release_id"),
		note: text("note"),
		...auditColumns,
	},
	(table) => [
		...contextForeignKeys("employee_apprentice_release", table),
		foreignKey({
			name: "employee_apprentice_release_exam_release_fk",
			columns: [table.examReleaseId],
			foreignColumns: [table.id],
		}),
		check(
			"employee_apprentice_release_exam_link_check",
			sql`"exam_release_id" IS NULL OR "release_kind" <> 'exam_day'`,
		),
		foreignKey({
			name: "employee_apprentice_release_superseded_by_fk",
			columns: [table.supersededByReleaseId],
			foreignColumns: [table.id],
		}),
		check(
			"employee_apprentice_release_superseded_check",
			sql`"superseded_by_release_id" IS NULL OR "voided_at" IS NOT NULL`,
		),
		check(
			"employee_apprentice_release_school_time_check",
			sql`("school_start_time" IS NULL AND "school_end_time" IS NULL) OR ("release_kind" = 'vocational_school_day' AND "school_start_time" IS NOT NULL AND "school_end_time" IS NOT NULL AND "school_end_time" > "school_start_time" AND "school_minutes" IS NOT NULL)`,
		),
		check("employee_apprentice_release_kind_check", textIn("release_kind", apprenticeReleaseKinds)),
		check("employee_apprentice_release_date_range_check", sql`"ends_on" >= "starts_on"`),
		check(
			"employee_apprentice_release_single_day_check",
			sql`"release_kind" = 'vocational_school_block_week' OR "ends_on" = "starts_on"`,
		),
		check(
			"employee_apprentice_release_amounts_check",
			sql`("lesson_count" IS NULL OR "lesson_count" BETWEEN 0 AND 20) AND ("school_minutes" IS NULL OR "school_minutes" BETWEEN 0 AND 10080)`,
		),
		check(
			"employee_apprentice_release_exam_time_check",
			sql`"exam_start_time" IS NULL OR ("release_kind" = 'exam_day' AND "school_minutes" IS NOT NULL)`,
		),
		check("employee_apprentice_release_void_check", voidCheckSql),
	],
);

export type OrganizationStatutoryPreference = typeof organizationStatutoryPreference.$inferSelect;
export type EmployeeStatutoryOffset = typeof employeeStatutoryOffset.$inferSelect;
export type EmployeeStudyPeriod = typeof employeeStudyPeriod.$inferSelect;
export type EmployeeApprenticeRelease = typeof employeeApprenticeRelease.$inferSelect;

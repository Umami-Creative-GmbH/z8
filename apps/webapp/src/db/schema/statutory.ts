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
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { employee } from "./organization";

// German statutory foundation (#1988, spec #1934). Migration: 0328_statutory_foundation.sql.
// The overlap exclusion constraints on study periods and apprentice releases live in SQL only.

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

/** Org-admin statutory warning tiers and the optional JArbSchG shift-publish block. No row = defaults. */
export const organizationStatutoryPreference = pgTable(
	"organization_statutory_preference",
	{
		organizationId: text("organization_id")
			.primaryKey()
			.references(() => organization.id, { onDelete: "cascade" }),
		warningThresholdPercent: integer("warning_threshold_percent").default(80).notNull(),
		criticalThresholdPercent: integer("critical_threshold_percent").default(95).notNull(),
		blockJarbschgShiftPublish: boolean("block_jarbschg_shift_publish").default(false).notNull(),
		updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	() => [
		check(
			"organization_statutory_preference_percent_check",
			sql`"warning_threshold_percent" BETWEEN 1 AND 100 AND "critical_threshold_percent" BETWEEN 1 AND 100 AND "warning_threshold_percent" < "critical_threshold_percent"`,
		),
	],
);

const voidColumns = {
	voidedAt: timestamp("voided_at", { withTimezone: true }),
	voidedBy: text("voided_by").references(() => user.id),
	voidReason: text("void_reason"),
};

/**
 * External / prior-employment statutory offsets. `valid_until_date` is exclusive.
 * - `external_minijob_monthly_earnings`: `amount_cents` + `currency` per month while valid.
 * - `prior_short_term_*`: `count_value` for exactly one calendar year (Jan 1 .. next Jan 1).
 * - `prior_working_student_over_20h_weeks`: `count_value` consecutive Monday–Sunday weeks above
 *   20 h, starting on the Monday `valid_from_date` (`valid_until_date` = start + 7 × count), so a
 *   rolling 12-month window can age each week out exactly.
 */
export const employeeStatutoryOffset = pgTable(
	"employee_statutory_offset",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		offsetKind: text("offset_kind").$type<EmployeeStatutoryOffsetKind>().notNull(),
		validFromDate: date("valid_from_date", { mode: "string" }).notNull(),
		validUntilDate: date("valid_until_date", { mode: "string" }),
		amountCents: integer("amount_cents"),
		currency: text("currency"),
		countValue: integer("count_value"),
		sourceEmployer: text("source_employer"),
		note: text("note").notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		...voidColumns,
	},
	(table) => [
		index("employeeStatutoryOffset_lookup_idx").on(
			table.organizationId,
			table.employeeId,
			table.offsetKind,
			table.validFromDate,
		),
		foreignKey({
			name: "employee_statutory_offset_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		check(
			"employee_statutory_offset_kind_check",
			textIn("offset_kind", employeeStatutoryOffsetKinds),
		),
		check(
			"employee_statutory_offset_date_range_check",
			sql`"valid_until_date" IS NULL OR "valid_until_date" > "valid_from_date"`,
		),
	],
);

/** Working-student lecture-free (semester break) intervals; `ends_on` is inclusive. */
export const employeeStudyPeriod = pgTable(
	"employee_study_period",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		periodKind: text("period_kind")
			.$type<EmployeeStudyPeriodKind>()
			.default("lecture_free")
			.notNull(),
		startsOn: date("starts_on", { mode: "string" }).notNull(),
		endsOn: date("ends_on", { mode: "string" }).notNull(),
		note: text("note"),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		...voidColumns,
	},
	(table) => [
		foreignKey({
			name: "employee_study_period_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		check("employee_study_period_kind_check", textIn("period_kind", employeeStudyPeriodKinds)),
		check("employee_study_period_date_range_check", sql`"ends_on" >= "starts_on"`),
	],
);

/** Apprentice vocational-school and exam release records (BBiG § 15 / JArbSchG § 9); `ends_on` inclusive. */
export const employeeApprenticeRelease = pgTable(
	"employee_apprentice_release",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		releaseKind: text("release_kind").$type<ApprenticeReleaseKind>().notNull(),
		startsOn: date("starts_on", { mode: "string" }).notNull(),
		endsOn: date("ends_on", { mode: "string" }).notNull(),
		/** School lessons on a vocational-school day (> 5 lessons credits a full day). */
		lessonCount: integer("lesson_count"),
		/** Planned school minutes of a block-release week (>= 25 h across >= 5 days). */
		schoolMinutes: integer("school_minutes"),
		note: text("note"),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		...voidColumns,
	},
	(table) => [
		foreignKey({
			name: "employee_apprentice_release_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		check("employee_apprentice_release_kind_check", textIn("release_kind", apprenticeReleaseKinds)),
		check("employee_apprentice_release_date_range_check", sql`"ends_on" >= "starts_on"`),
	],
);

export type OrganizationStatutoryPreference = typeof organizationStatutoryPreference.$inferSelect;
export type EmployeeStatutoryOffset = typeof employeeStatutoryOffset.$inferSelect;
export type EmployeeStudyPeriod = typeof employeeStudyPeriod.$inferSelect;
export type EmployeeApprenticeRelease = typeof employeeApprenticeRelease.$inferSelect;

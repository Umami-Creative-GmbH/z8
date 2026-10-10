import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	date,
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
import { employee } from "./organization";
import { currentTimestamp } from "./timestamp";

// ============================================
// CLOSED MONTHS (#762, Time Tracking ADR-0004)
// ============================================

/**
 * One close of a calendar month, for the organization or one team. The
 * employees it covers, with their fixed ranges, are `closed_month_employee`.
 * An organization close also covers employees added later
 * (`covers_new_employees`), until the month is reopened for everything.
 */
export const closedMonth = pgTable(
	"closed_month",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		/** The first day of the calendar month. */
		month: date("month").notNull(),
		scope: text("scope", { enum: ["organization", "team"] }).notNull(),
		/** The team of a team close. History keeps it after the team is deleted. */
		teamId: uuid("team_id"),
		coversNewEmployees: boolean("covers_new_employees").default(false).notNull(),
		actorKind: text("actor_kind", { enum: ["user", "system"] }).notNull(),
		closedBy: text("closed_by").references(() => user.id, { onDelete: "set null" }),
		closedAt: timestamp("closed_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("closedMonth_organizationId_month_idx").on(table.organizationId, table.month),
		check("closed_month_month_first_day_check", sql`extract(day from ${table.month}) = 1`),
		check(
			"closed_month_scope_check",
			sql`(${table.scope} = 'organization' AND ${table.teamId} IS NULL) OR (${table.scope} = 'team' AND ${table.teamId} IS NOT NULL AND NOT ${table.coversNewEmployees})`,
		),
		check(
			"closed_month_actor_check",
			sql`${table.actorKind} = 'user' OR ${table.closedBy} IS NULL`,
		),
	],
);

/** One reopening of a closed month, with its reason. */
export const closedMonthReopening = pgTable(
	"closed_month_reopening",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		month: date("month").notNull(),
		scope: text("scope", { enum: ["employees", "team", "all"] }).notNull(),
		teamId: uuid("team_id"),
		reason: text("reason").notNull(),
		employeeCount: integer("employee_count").notNull(),
		reopenedBy: text("reopened_by").references(() => user.id, { onDelete: "set null" }),
		reopenedAt: timestamp("reopened_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("closedMonthReopening_organizationId_month_idx").on(table.organizationId, table.month),
		check(
			"closed_month_reopening_month_first_day_check",
			sql`extract(day from ${table.month}) = 1`,
		),
		check("closed_month_reopening_reason_check", sql`length(btrim(${table.reason})) > 0`),
		check("closed_month_reopening_employee_count_check", sql`${table.employeeCount} >= 0`),
		check(
			"closed_month_reopening_scope_check",
			sql`(${table.scope} = 'team') = (${table.teamId} IS NOT NULL)`,
		),
	],
);

/**
 * The closed range of one employee: the month in their effective timezone,
 * fixed as UTC instants when they were first covered. A later timezone or team
 * change never moves it. `reopened_at` lifts it; a later close adds a new row.
 */
export const closedMonthEmployee = pgTable(
	"closed_month_employee",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		closedMonthId: uuid("closed_month_id")
			.notNull()
			.references(() => closedMonth.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		month: date("month").notNull(),
		/** Inclusive start of the closed range (UTC, like `work_period.start_time`). */
		rangeStart: timestamp("range_start").notNull(),
		/** Exclusive end of the closed range (UTC). */
		rangeEnd: timestamp("range_end").notNull(),
		timezone: text("timezone").notNull(),
		/** The employee's primary team when they were covered. */
		teamId: uuid("team_id"),
		coveredAt: timestamp("covered_at", { withTimezone: true }).defaultNow().notNull(),
		reopeningId: uuid("reopening_id").references(() => closedMonthReopening.id, {
			onDelete: "set null",
		}),
		reopenedAt: timestamp("reopened_at", { withTimezone: true }),
	},
	(table) => [
		uniqueIndex("closedMonthEmployee_employee_month_closed_idx")
			.on(table.employeeId, table.month)
			.where(sql`${table.reopenedAt} IS NULL`),
		index("closedMonthEmployee_employee_range_idx")
			.on(table.employeeId, table.rangeStart, table.rangeEnd)
			.where(sql`${table.reopenedAt} IS NULL`),
		index("closedMonthEmployee_organizationId_month_idx").on(table.organizationId, table.month),
		index("closedMonthEmployee_closedMonthId_idx").on(table.closedMonthId),
		check("closed_month_employee_range_check", sql`${table.rangeEnd} > ${table.rangeStart}`),
	],
);

/** Automatic close (#762): off by default; closes N days after month-end. */
export const closedMonthSetting = pgTable(
	"closed_month_setting",
	{
		organizationId: text("organization_id")
			.primaryKey()
			.references(() => organization.id, { onDelete: "cascade" }),
		autoCloseEnabled: boolean("auto_close_enabled").default(false).notNull(),
		autoCloseAfterDays: integer("auto_close_after_days").default(5).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		check(
			"closed_month_setting_after_days_check",
			sql`${table.autoCloseAfterDays} BETWEEN 1 AND 60`,
		),
	],
);

/**
 * One automatic close attempt per organization, month and local day, so a
 * rerun of the daily job neither closes twice nor notifies twice.
 */
export const closedMonthAutoCloseRun = pgTable(
	"closed_month_auto_close_run",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		month: date("month").notNull(),
		runDate: date("run_date").notNull(),
		outcome: text("outcome", { enum: ["pending", "closed", "blocked", "skipped"] }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		unique("closedMonthAutoCloseRun_org_month_day_idx").on(
			table.organizationId,
			table.month,
			table.runDate,
		),
	],
);

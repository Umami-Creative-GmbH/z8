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
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization } from "../auth-schema";
import { notificationTypeEnum, roleEnum } from "./enums";
import { employee } from "./organization";

/**
 * Per-organization clocking reminder settings (#760). One enabled/minutes pair per reminder type;
 * a missing row means every reminder is off. Later reminder types add their own column pair.
 */
export const organizationClockingReminderSettings = pgTable(
	"organization_clocking_reminder_settings",
	{
		organizationId: text("organization_id")
			.primaryKey()
			.references(() => organization.id, { onDelete: "cascade" }),
		missedClockInEnabled: boolean("missed_clock_in_enabled").default(false).notNull(),
		missedClockInGraceMinutes: integer("missed_clock_in_grace_minutes").default(15).notNull(),
		forgottenClockOutEnabled: boolean("forgotten_clock_out_enabled").default(false).notNull(),
		forgottenClockOutGraceMinutes: integer("forgotten_clock_out_grace_minutes")
			.default(30)
			.notNull(),
		// Break-due reminder (#833): minutes before live work breaks the policy's break rules.
		breakDueEnabled: boolean("break_due_enabled").default(false).notNull(),
		breakDueLeadMinutes: integer("break_due_lead_minutes").default(15).notNull(),
		roles: roleEnum("roles").array().default(sql`'{admin,manager,employee}'::role[]`).notNull(),
		revision: integer("revision").default(1).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		check(
			"organization_clocking_reminder_settings_missed_grace_check",
			sql`${table.missedClockInGraceMinutes} BETWEEN 0 AND 1440`,
		),
		check(
			"organization_clocking_reminder_settings_forgotten_grace_check",
			sql`${table.forgottenClockOutGraceMinutes} BETWEEN 0 AND 1440`,
		),
		check(
			"organization_clocking_reminder_settings_break_due_lead_check",
			sql`${table.breakDueLeadMinutes} BETWEEN 1 AND 1440`,
		),
		check(
			"organization_clocking_reminder_settings_roles_check",
			sql`cardinality(${table.roles}) >= 1`,
		),
		check("organization_clocking_reminder_settings_revision_check", sql`${table.revision} >= 1`),
	],
);

/**
 * One row per clocking reminder occasion that was sent. The unique occasion key is claimed before
 * any channel is delivered, so reruns and overlapping runs never send a reminder twice.
 */
export const clockingReminderOccasion = pgTable(
	"clocking_reminder_occasion",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		type: notificationTypeEnum("type").notNull(),
		occasionKey: text("occasion_key").notNull(),
		expectedAt: timestamp("expected_at", { withTimezone: true }).notNull(),
		sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
	},
	(table) => [
		foreignKey({
			name: "clocking_reminder_occasion_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		uniqueIndex("clockingReminderOccasion_org_key_idx").on(table.organizationId, table.occasionKey),
		// Serves the per-organization retention delete (#919).
		index("clockingReminderOccasion_org_expectedAt_idx").on(table.organizationId, table.expectedAt),
	],
);

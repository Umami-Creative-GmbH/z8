import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { organization } from "../auth-schema";
import { employeeEmploymentPeriod } from "./employee-lifecycle";
import { employee } from "./organization";

// Each report is a separate cause, independent of the latest check's global failure.
export const drivingImpedimentReport = pgTable(
	"driving_impediment_report",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		employmentPeriodId: uuid("employment_period_id"),
		commandId: uuid("command_id").notNull(),
		scope: text("scope").$type<"person">().notNull().default("person"),
		reportedAt: timestamp("reported_at", { withTimezone: true }).notNull(),
		reporterUserId: text("reporter_user_id").notNull(),
		retentionStartedAt: timestamp("retention_started_at", {
			withTimezone: true,
		}),
		resolvedAt: timestamp("resolved_at", { withTimezone: true }),
		resolvedByUserId: text("resolved_by_user_id"),
		resolutionCheckId: uuid("resolution_check_id"),
	},
	(t) => [
		unique("driving_impediment_command").on(t.organizationId, t.commandId),
		index("driving_impediment_unresolved")
			.on(t.organizationId, t.employeeId, t.reportedAt)
			.where(sql`${t.resolvedAt} IS NULL`),
		foreignKey({
			columns: [t.employeeId, t.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			columns: [t.employmentPeriodId, t.organizationId, t.employeeId],
			foreignColumns: [
				employeeEmploymentPeriod.id,
				employeeEmploymentPeriod.organizationId,
				employeeEmploymentPeriod.employeeId,
			],
		}),
		check("driving_impediment_person_scope", sql`${t.scope}='person'`),
		check(
			"driving_impediment_resolution",
			sql`(${t.resolvedAt} IS NULL AND ${t.resolvedByUserId} IS NULL AND ${t.resolutionCheckId} IS NULL) OR (${t.resolvedAt} IS NOT NULL AND ${t.resolvedByUserId} IS NOT NULL AND ${t.resolutionCheckId} IS NOT NULL)`,
		),
	],
);

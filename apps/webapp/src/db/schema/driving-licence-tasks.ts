import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { employeeEmploymentPeriod } from "./employee-lifecycle";
import { employee } from "./organization";

/** An assignment is workflow evidence, never direct employee delivery or a read receipt. */
export const drivingLicenceTask = pgTable(
	"driving_licence_task",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		employmentPeriodId: uuid("employment_period_id"),
		occasionKey: text("occasion_key").notNull(),
		kind: text("kind").$type<"personal_reminder" | "reassignment">().notNull(),
		state: text("state")
			.$type<"pending" | "completed" | "obsolete">()
			.default("pending")
			.notNull(),
		generation: integer("generation").default(1).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		completedBy: text("completed_by").references(() => user.id, {
			onDelete: "set null",
		}),
	},
	(t) => [
		unique("driving_task_occasion").on(t.organizationId, t.kind, t.occasionKey),
		index("driving_task_org_employee").on(t.organizationId, t.employeeId),
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
		check(
			"driving_task_kind",
			sql`${t.kind} IN ('personal_reminder','reassignment')`,
		),
		check(
			"driving_task_state",
			sql`${t.state} IN ('pending','completed','obsolete')`,
		),
	],
);

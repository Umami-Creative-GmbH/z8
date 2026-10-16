import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import type { DrivingCheckCorrection } from "@/lib/organization/driving-licence/history-types";
import { organization, user } from "../auth-schema";
import { drivingLicenceCheck } from "./driving-licence-checks";
import { employee } from "./organization";
export const drivingLicenceSupplement = pgTable(
	"driving_licence_supplement",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		checkId: uuid("check_id").notNull(),
		commandId: uuid("command_id").notNull(),
		authorEmployeeId: uuid("author_employee_id").notNull(),
		authorUserId: text("author_user_id")
			.notNull()
			.references(() => user.id),
		authorName: text("author_name").notNull(),
		recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
		reason: text("reason")
			.$type<"recording_error" | "missing_detail">()
			.notNull(),
		correction: jsonb("correction").$type<DrivingCheckCorrection>().notNull(),
	},
	(t) => [
		unique("driving_supplement_command").on(t.organizationId, t.commandId),
		foreignKey({
			columns: [t.organizationId, t.checkId],
			foreignColumns: [
				drivingLicenceCheck.organizationId,
				drivingLicenceCheck.id,
			],
		}).onDelete("cascade"),
		foreignKey({
			columns: [t.employeeId, t.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			columns: [t.authorEmployeeId, t.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}),
		check(
			"driving_supplement_reason",
			sql`${t.reason} IN ('recording_error','missing_detail')`,
		),
	],
);

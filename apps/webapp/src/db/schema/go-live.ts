import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { employee, team } from "./organization";

/**
 * The teams an org admin narrowed the go-live group to (#1513, Organization
 * glossary "Going live"). No rows: the whole current roster plus pending
 * invitees. A member is in when their primary team (or an invitee's draft team)
 * is one of these. Deleting a team drops its row.
 */
export const goLiveGroupTeam = pgTable(
	"go_live_group_team",
	{
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		teamId: uuid("team_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
	},
	(t) => [
		primaryKey({ name: "go_live_group_team_pk", columns: [t.organizationId, t.teamId] }),
		foreignKey({
			name: "go_live_group_team_team_fk",
			columns: [t.teamId, t.organizationId],
			foreignColumns: [team.id, team.organizationId],
		}).onDelete("cascade"),
	],
);

/**
 * A go-live exclusion (#1513): an admin's recorded decision, with a reason, to
 * leave one employee out of the go-live group. Open until lifted
 * (`lifted_at`/`lifted_by`) or until the employee becomes a former employee,
 * when the 0289 trigger stamps `ended_at`. A rehired employee needs a new one.
 */
export const goLiveExclusion = pgTable(
	"go_live_exclusion",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		reason: text("reason").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		liftedAt: timestamp("lifted_at", { withTimezone: true }),
		liftedBy: text("lifted_by").references(() => user.id),
		endedAt: timestamp("ended_at", { withTimezone: true }),
	},
	(t) => [
		uniqueIndex("go_live_exclusion_open_idx")
			.on(t.organizationId, t.employeeId)
			.where(sql`lifted_at IS NULL AND ended_at IS NULL`),
		index("go_live_exclusion_employee_idx").on(t.employeeId),
		check("go_live_exclusion_reason_check", sql`length(btrim(${t.reason})) > 0`),
		check("go_live_exclusion_lifted_check", sql`(${t.liftedAt} is null) = (${t.liftedBy} is null)`),
		check(
			"go_live_exclusion_closed_once_check",
			sql`${t.liftedAt} is null or ${t.endedAt} is null`,
		),
		foreignKey({
			name: "go_live_exclusion_employee_fk",
			columns: [t.employeeId, t.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
	],
);

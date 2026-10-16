import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	integer,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { organization } from "../auth-schema";
import { drivingLicenceCheck } from "./driving-licence-checks";

export const drivingLicenceRetention = pgTable(
	"driving_licence_retention",
	{
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		checkId: uuid("check_id").notNull(),
		retentionStartedAt: timestamp("retention_started_at", {
			withTimezone: true,
		}),
	},
	(t) => [
		unique("driving_retention_check").on(t.organizationId, t.checkId),
		foreignKey({
			columns: [t.organizationId, t.checkId],
			foreignColumns: [
				drivingLicenceCheck.organizationId,
				drivingLicenceCheck.id,
			],
		}).onDelete("cascade"),
	],
);
export const drivingLicenceHold = pgTable(
	"driving_licence_hold",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		checkId: uuid("check_id").notNull(),
		caseReference: text("case_reference").notNull(),
		preservationReason: text("preservation_reason").notNull(),
		placedAt: timestamp("placed_at", { withTimezone: true }).notNull(),
		placedBy: text("placed_by").notNull(),
		releasedAt: timestamp("released_at", { withTimezone: true }),
		releasedBy: text("released_by"),
		releaseReason: text("release_reason"),
	},
	(t) => [
		foreignKey({
			columns: [t.organizationId, t.checkId],
			foreignColumns: [
				drivingLicenceCheck.organizationId,
				drivingLicenceCheck.id,
			],
		}).onDelete("cascade"),
		check(
			"driving_hold_specific_case",
			sql`length(trim(${t.caseReference})) >= 3 AND length(trim(${t.preservationReason})) >= 10`,
		),
	],
);
/** Aggregate operational audit; no deleted evidence or employee identifiers. */
export const drivingLicenceCleanupRun = pgTable("driving_licence_cleanup_run", {
	id: uuid("id").defaultRandom().primaryKey(),
	organizationId: text("organization_id")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
	completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
	actorUserId: text("actor_user_id"),
	deletedCount: integer("deleted_count").notNull(),
	heldCount: integer("held_count").notNull(),
	protectedCount: integer("protected_count").notNull(),
});

import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

import { organization, user } from "../auth-schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { employee } from "./organization";

export type WorksCouncilIdentityVisibility = "aggregated" | "pseudonymized" | "named";
export type WorksCouncilAbsenceVisibility = "hidden" | "grouped" | "category";
export type WorksCouncilAccessEventType =
	| "portal_viewed"
	| "settings_updated"
	| "export_requested"
	| "export_failed";

export const worksCouncilSettings = pgTable(
	"works_council_settings",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		enabled: boolean("enabled").default(false).notNull(),
		identityVisibility: text("identity_visibility")
			.$type<WorksCouncilIdentityVisibility>()
			.default("aggregated")
			.notNull(),
		absenceVisibility: text("absence_visibility")
			.$type<WorksCouncilAbsenceVisibility>()
			.default("hidden")
			.notNull(),
		exportEnabled: boolean("export_enabled").default(false).notNull(),
		minimumAggregationThreshold: integer("minimum_aggregation_threshold").default(5).notNull(),
		visibleTeamIds: jsonb("visible_team_ids").$type<string[]>().default([]).notNull(),
		visibleLocationIds: jsonb("visible_location_ids").$type<string[]>().default([]).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id),
	},
	(table) => [
		uniqueIndex("worksCouncilSettings_organizationId_idx").on(table.organizationId),
		index("worksCouncilSettings_enabled_idx").on(table.enabled),
	],
);

export const worksCouncilAccessAudit = pgTable(
	"works_council_access_audit",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		actorUserId: text("actor_user_id")
			.notNull()
			.references(() => user.id),
		actorEmployeeId: uuid("actor_employee_id").references(() => employee.id, { onDelete: "set null" }),
		eventType: text("event_type").$type<WorksCouncilAccessEventType>().notNull(),
		dateRangeStart: timestamp("date_range_start", { withTimezone: true }),
		dateRangeEnd: timestamp("date_range_end", { withTimezone: true }),
		metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("worksCouncilAccessAudit_org_createdAt_idx").on(table.organizationId, table.createdAt),
		index("worksCouncilAccessAudit_actor_createdAt_idx").on(table.actorUserId, table.createdAt),
		index("worksCouncilAccessAudit_eventType_idx").on(table.eventType),
	],
);

export const worksCouncilReviewExport = pgTable(
	"works_council_review_export",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		requestedByUserId: text("requested_by_user_id")
			.notNull()
			.references(() => user.id),
		requestedByEmployeeId: uuid("requested_by_employee_id").references(() => employee.id, {
			onDelete: "set null",
		}),
		dateRangeStart: timestamp("date_range_start", { withTimezone: true }).notNull(),
		dateRangeEnd: timestamp("date_range_end", { withTimezone: true }).notNull(),
		visibilitySnapshot: jsonb("visibility_snapshot")
			.$type<{
				identityVisibility: WorksCouncilIdentityVisibility;
				absenceVisibility: WorksCouncilAbsenceVisibility;
				minimumAggregationThreshold: number;
				visibleTeamIds: string[];
				visibleLocationIds: string[];
			}>()
			.notNull(),
		status: text("status").$type<"completed" | "failed">().notNull(),
		rowCount: integer("row_count").default(0).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("worksCouncilReviewExport_org_createdAt_idx").on(table.organizationId, table.createdAt),
		index("worksCouncilReviewExport_requestedBy_idx").on(table.requestedByUserId),
		index("worksCouncilReviewExport_range_idx").on(
			table.organizationId,
			table.dateRangeStart,
			table.dateRangeEnd,
		),
	],
);

export type WorksCouncilSettings = typeof worksCouncilSettings.$inferSelect;
export type NewWorksCouncilSettings = typeof worksCouncilSettings.$inferInsert;
export type WorksCouncilAccessAudit = typeof worksCouncilAccessAudit.$inferSelect;
export type WorksCouncilReviewExport = typeof worksCouncilReviewExport.$inferSelect;

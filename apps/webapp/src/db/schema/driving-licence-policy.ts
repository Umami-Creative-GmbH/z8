import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
export const drivingLicencePolicy = pgTable(
	"driving_licence_policy",
	{
		organizationId: text("organization_id")
			.primaryKey()
			.references(() => organization.id, { onDelete: "cascade" }),
		enabled: boolean("enabled").default(false).notNull(),
		intervalMonths: integer("interval_months").notNull(),
		timezone: text("timezone").notNull(),
		reminderLeadDays: jsonb("reminder_lead_days").$type<number[]>().notNull(),
		retentionMonths: integer("retention_months"),
		retentionJustification: text("retention_justification"),
		version: integer("version").default(1).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
		updatedBy: text("updated_by")
			.notNull()
			.references(() => user.id),
	},
	(t) => [
		check(
			"driving_licence_policy_interval",
			sql`${t.intervalMonths} between 1 and 120`,
		),
		check(
			"driving_licence_policy_retention",
			sql`${t.retentionMonths} is null or ${t.retentionMonths} between 1 and 120`,
		),
		check(
			"driving_licence_policy_activation",
			sql`not ${t.enabled} or (${t.retentionMonths} is not null and ${t.retentionJustification} is not null and length(trim(${t.retentionJustification})) >= 10)`,
		),
	],
);
export const drivingLicencePolicyRevision = pgTable(
	"driving_licence_policy_revision",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		version: integer("version").notNull(),
		policy: jsonb("policy")
			.$type<{
				enabled: boolean;
				intervalMonths: number;
				timezone: string;
				reminderLeadDays: number[];
				retentionMonths: number | null;
				retentionJustification: string | null;
			}>()
			.notNull(),
		changedAt: timestamp("changed_at", { withTimezone: true }).notNull(),
		changedBy: text("changed_by")
			.notNull()
			.references(() => user.id),
	},
	(t) => [
		unique("driving_licence_policy_revision_version").on(
			t.organizationId,
			t.version,
		),
	],
);

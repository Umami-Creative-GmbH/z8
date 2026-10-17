import {
	boolean,
	date,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { organization } from "../auth-schema";
import { employee } from "./organization";
import { vacationAllowance } from "./vacation";

/** Organization calendar date from which reviewed eligibility is known. */
export const vacationPolicyRollout = pgTable("vacation_policy_rollout", {
	organizationId: text("organization_id")
		.primaryKey()
		.references(() => organization.id, { onDelete: "cascade" }),
	baselineDate: date("baseline_date").notNull(),
	reviewedFrom: date("reviewed_from"),
	/** Enabled only when balance readers and automated postings share the dated contract. */
	calculationsEnabled: boolean("calculations_enabled").default(false).notNull(),
});

/** Vacation-only eligibility survives deletion of the live membership and team. */
export const vacationTeamEligibility = pgTable(
	"vacation_team_eligibility",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		teamId: uuid("team_id").notNull(),
		originId: uuid("origin_id").notNull(),
		source: text("source").$type<"membership" | "compatibility">().notNull(),
		effectiveStartDate: date("effective_start_date").notNull(),
		effectiveEndDate: date("effective_end_date"),
		legacyBaseline: boolean("legacy_baseline").default(false).notNull(),
	},
	(table) => [
		index("vacation_team_eligibility_employee_idx").on(
			table.organizationId,
			table.employeeId,
		),
	],
);

/** Frozen policy terms, in database column spelling, with half-open date windows. */
export const vacationPolicyRevision = pgTable(
	"vacation_policy_revision",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		policyId: uuid("policy_id")
			.notNull()
			.references(() => vacationAllowance.id, { onDelete: "cascade" }),
		effectiveStartDate: date("effective_start_date").notNull(),
		effectiveEndDate: date("effective_end_date"),
		policy: jsonb("policy").$type<Record<string, unknown>>().notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("vacation_policy_revision_policy_idx").on(
			table.organizationId,
			table.policyId,
		),
	],
);

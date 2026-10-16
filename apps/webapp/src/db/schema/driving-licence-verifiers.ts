import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { employeeEmploymentPeriod } from "./employee-lifecycle";
import { employee } from "./organization";

/** Explicit verifier responsibility; old grants remain attributable after replacement or revocation. */
export const drivingLicenceVerifierGrant = pgTable(
	"driving_licence_verifier_grant",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		verifierEmployeeId: uuid("verifier_employee_id").notNull(),
		employmentPeriodId: uuid("employment_period_id"),
		scope: text("scope").$type<"all" | "specific">().notNull(),
		teamIds: jsonb("team_ids").$type<string[]>().default([]).notNull(),
		employeeIds: jsonb("employee_ids").$type<string[]>().default([]).notNull(),
		grantedAt: timestamp("granted_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		grantedBy: text("granted_by")
			.notNull()
			.references(() => user.id),
		expiresAt: timestamp("expires_at", { withTimezone: true }),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		revokedBy: text("revoked_by").references(() => user.id),
	},
	(table) => [
		foreignKey({
			name: "driving_verifier_employee_org_fk",
			columns: [table.verifierEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "driving_verifier_period_fk",
			columns: [
				table.employmentPeriodId,
				table.organizationId,
				table.verifierEmployeeId,
			],
			foreignColumns: [
				employeeEmploymentPeriod.id,
				employeeEmploymentPeriod.organizationId,
				employeeEmploymentPeriod.employeeId,
			],
		}),
		index("driving_verifier_organization_idx").on(table.organizationId),
		uniqueIndex("driving_verifier_one_current_idx")
			.on(table.organizationId, table.verifierEmployeeId)
			.where(sql`${table.revokedAt} IS NULL`),
		check(
			"driving_verifier_scope_check",
			sql`${table.scope} IN ('all', 'specific')`,
		),
		check(
			"driving_verifier_scope_arrays_check",
			sql`jsonb_typeof(${table.teamIds}) = 'array' AND jsonb_typeof(${table.employeeIds}) = 'array'`,
		),
		check(
			"driving_verifier_nonempty_scope_check",
			sql`(${table.scope} = 'all' AND jsonb_array_length(${table.teamIds}) = 0 AND jsonb_array_length(${table.employeeIds}) = 0) OR (${table.scope} = 'specific' AND (jsonb_array_length(${table.teamIds}) > 0 OR jsonb_array_length(${table.employeeIds}) > 0))`,
		),
		check(
			"driving_verifier_expiry_check",
			sql`${table.expiresAt} IS NULL OR ${table.expiresAt} > ${table.grantedAt}`,
		),
		check(
			"driving_verifier_revocation_check",
			sql`(${table.revokedAt} IS NULL) = (${table.revokedBy} IS NULL)`,
		),
	],
);

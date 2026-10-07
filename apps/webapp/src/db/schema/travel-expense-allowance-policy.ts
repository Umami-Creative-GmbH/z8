import { sql } from "drizzle-orm";
import {
	check,
	date,
	decimal,
	foreignKey,
	index,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import type {
	AllowancePolicyKind,
	AllowancePolicySourceKind,
} from "@/lib/travel-expenses/allowance-policy.types";
import type { MileageVehicle } from "@/lib/travel-expenses/mileage.types";
import { organization, user } from "../auth-schema";

/**
 * Dated organization allowance policies (#606). One policy per organization
 * and allowance kind; its versions are immutable once activated (only
 * `withdrawn_*` is ever set) and apply from `effective_from` until the next
 * active version starts, so at most one active version may start on a day.
 * Activation and withdrawal lock the policy row (`allowance-policy-store.ts`).
 * Kind-specific rates live in child tables keyed by the version, like
 * `travel_expense_mileage_rate`; per diem (#609) adds its own.
 */
export const travelExpenseAllowancePolicy = pgTable(
	"travel_expense_allowance_policy",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		kind: text("kind").$type<AllowancePolicyKind>().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		uniqueIndex("travelExpenseAllowancePolicy_id_org_idx").on(table.id, table.organizationId),
		uniqueIndex("travelExpenseAllowancePolicy_org_kind_idx").on(table.organizationId, table.kind),
		check(
			"travel_expense_allowance_policy_kind_check",
			sql`${table.kind} IN ('mileage', 'per_diem')`,
		),
	],
);

export const travelExpenseAllowancePolicyVersion = pgTable(
	"travel_expense_allowance_policy_version",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").notNull(),
		policyId: uuid("policy_id").notNull(),
		effectiveFrom: date("effective_from").notNull(),
		currency: text("currency").notNull(),
		sourceKind: text("source_kind").$type<AllowancePolicySourceKind>().notNull(),
		sourceReference: text("source_reference"),
		sourceVersion: text("source_version"),
		/** Catalog key of an adopted statutory default. */
		defaultKey: text("default_key"),
		/** The administrator's reason or note for this version. */
		note: text("note"),
		/** The version this one replaced (same `effective_from`), if any. */
		replacesVersionId: uuid("replaces_version_id"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
		withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
		withdrawnBy: text("withdrawn_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		foreignKey({
			name: "travel_expense_allowance_policy_version_policy_fk",
			columns: [table.policyId, table.organizationId],
			foreignColumns: [
				travelExpenseAllowancePolicy.id,
				travelExpenseAllowancePolicy.organizationId,
			],
		}).onDelete("cascade"),
		uniqueIndex("travelExpenseAllowancePolicyVersion_id_org_idx").on(
			table.id,
			table.organizationId,
		),
		// Active versions never start on the same day; a later start ends the earlier one.
		uniqueIndex("travelExpenseAllowancePolicyVersion_active_start_idx")
			.on(table.policyId, table.effectiveFrom)
			.where(sql`withdrawn_at IS NULL`),
		index("travelExpenseAllowancePolicyVersion_org_idx").on(table.organizationId),
		check(
			"travel_expense_allowance_policy_version_currency_check",
			sql`${table.currency} ~ '^[A-Z]{3}$'`,
		),
		check(
			"travel_expense_allowance_policy_version_source_check",
			sql`(${table.sourceKind} = 'organization' AND ${table.defaultKey} IS NULL)
			OR (${table.sourceKind} = 'statutory_default' AND ${table.defaultKey} IS NOT NULL
				AND ${table.sourceReference} IS NOT NULL AND ${table.sourceVersion} IS NOT NULL)`,
		),
		check(
			"travel_expense_allowance_policy_version_withdrawn_check",
			sql`${table.withdrawnBy} IS NULL OR ${table.withdrawnAt} IS NOT NULL`,
		),
	],
);

/** The rate per kilometre of one vehicle class in a mileage policy version. */
export const travelExpenseMileageRate = pgTable(
	"travel_expense_mileage_rate",
	{
		versionId: uuid("version_id").notNull(),
		organizationId: text("organization_id").notNull(),
		vehicle: text("vehicle").$type<MileageVehicle>().notNull(),
		ratePerKm: decimal("rate_per_km", { precision: 8, scale: 4 }).notNull(),
	},
	(table) => [
		primaryKey({
			name: "travel_expense_mileage_rate_pk",
			columns: [table.versionId, table.vehicle],
		}),
		foreignKey({
			name: "travel_expense_mileage_rate_version_fk",
			columns: [table.versionId, table.organizationId],
			foreignColumns: [
				travelExpenseAllowancePolicyVersion.id,
				travelExpenseAllowancePolicyVersion.organizationId,
			],
		}).onDelete("cascade"),
		check(
			"travel_expense_mileage_rate_vehicle_check",
			sql`${table.vehicle} IN ('car', 'other_motor_vehicle')`,
		),
		check(
			"travel_expense_mileage_rate_amount_check",
			sql`${table.ratePerKm} > 0 AND ${table.ratePerKm} <= 100`,
		),
	],
);

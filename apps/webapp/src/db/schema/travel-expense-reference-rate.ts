import { sql } from "drizzle-orm";
import {
	check,
	date,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import type {
	ReferenceRateAcknowledgement,
	ReferenceRateProvider,
} from "@/lib/travel-expenses/reference-rate";
import { organization, user } from "../auth-schema";

// Reference exchange rates as a conversion basis (#608). ECB reference rates
// are public reference data, not tenant data, so the publications and the
// provider's fetch state are global; only an organization's approval of the
// source is organization-scoped.

// An organization's explicit approval of a reference-rate source. No row
// means reference conversion is off; revoking deletes the row. Drafts follow
// the current approval, submissions keep the one they froze.
export const travelExpenseReferenceRatePolicy = pgTable(
	"travel_expense_reference_rate_policy",
	{
		organizationId: text("organization_id")
			.primaryKey()
			.references(() => organization.id, { onDelete: "cascade" }),
		provider: text("provider").$type<ReferenceRateProvider>().notNull(),
		approvedBy: text("approved_by").references(() => user.id, { onDelete: "set null" }),
		approvedByName: text("approved_by_name").notNull(),
		approvedAt: timestamp("approved_at", { withTimezone: true }).notNull(),
		// 0131: the versioned statement the approver acknowledged with this
		// approval, and when (the approver above is who acknowledged it).
		acknowledgement: text("acknowledgement").$type<ReferenceRateAcknowledgement>().notNull(),
		acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull(),
	},
	(table) => [
		check("travel_expense_reference_rate_policy_provider_check", sql`${table.provider} IN ('ecb')`),
		check(
			"travel_expense_reference_rate_policy_acknowledgement_check",
			sql`${table.provider} = 'ecb' AND ${table.acknowledgement} IN ('ecb_information_only_v1')`,
		),
	],
);

// Every fetched publication. A publication whose rates changed in a later
// fetch (an ECB correction) is kept and superseded by the next version of its
// date, so a submission's frozen rate always stays traceable.
export const travelExpenseReferenceRatePublication = pgTable(
	"travel_expense_reference_rate_publication",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		provider: text("provider").$type<ReferenceRateProvider>().notNull(),
		publicationDate: date("publication_date").notNull(),
		version: integer("version").notNull(),
		// `1 EUR = rate` per ISO currency code, as normalized decimal strings.
		rates: jsonb("rates").$type<Record<string, string>>().notNull(),
		contentSha256: text("content_sha256").notNull(),
		sourceUrl: text("source_url").notNull(),
		retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
		supersededAt: timestamp("superseded_at", { withTimezone: true }),
	},
	(table) => [
		uniqueIndex("travelExpenseReferenceRatePublication_version_idx").on(
			table.provider,
			table.publicationDate,
			table.version,
		),
		uniqueIndex("travelExpenseReferenceRatePublication_current_idx")
			.on(table.provider, table.publicationDate)
			.where(sql`${table.supersededAt} IS NULL`),
		index("travelExpenseReferenceRatePublication_date_idx").on(
			table.provider,
			table.publicationDate,
		),
		check(
			"travel_expense_reference_rate_publication_check",
			sql`${table.provider} IN ('ecb') AND ${table.version} >= 1
				AND ${table.contentSha256} ~ '^[0-9a-f]{64}$'`,
		),
	],
);

// How far each provider's stored history is complete, and how its fetches went.
export const travelExpenseReferenceRateProviderState = pgTable(
	"travel_expense_reference_rate_provider_state",
	{
		provider: text("provider").$type<ReferenceRateProvider>().primaryKey(),
		// Every publication from this date on is stored (null before the first fetch).
		historyFrom: date("history_from"),
		latestSuccessAt: timestamp("latest_success_at", { withTimezone: true }),
		latestAttemptAt: timestamp("latest_attempt_at", { withTimezone: true }).notNull(),
		latestFailure: text("latest_failure"),
		latestFailureAt: timestamp("latest_failure_at", { withTimezone: true }),
	},
	(table) => [
		check("travel_expense_reference_rate_provider_state_check", sql`${table.provider} IN ('ecb')`),
	],
);

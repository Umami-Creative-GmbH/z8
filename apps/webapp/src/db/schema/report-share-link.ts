import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	date,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import type { SharedSnapshot } from "@/lib/projects/report-share/shared-snapshot";
import { organization, user } from "../auth-schema";
import { customer } from "./customer";
import { employee } from "./organization";
import { project } from "./project";

// ============================================
// REPORT SHARE LINKS (#806)
// ============================================

export const REPORT_SHARE_LINK_KINDS = ["project", "customer"] as const;
export type ReportShareLinkKind = (typeof REPORT_SHARE_LINK_KINDS)[number];

export const REPORT_SHARE_LINK_FIGURES = ["hours", "revenue"] as const;

export const REPORT_SHARE_LINK_REVOKE_REASONS = [
	"manual",
	"creator_lost_access",
	"expired",
] as const;
export type ReportShareLinkRevokeReason = (typeof REPORT_SHARE_LINK_REVOKE_REASONS)[number];

function textIn(column: string, values: readonly string[]): string {
	return `${column} IN (${values.map((value) => `'${value}'`).join(", ")})`;
}

/**
 * A report share link: a secret, expiring URL that shows one shared snapshot
 * of a project's report or one customer's billable report to someone outside
 * Z8. Only the token's digest is stored, so the URL cannot be read back.
 *
 * Expiry and revocation delete the snapshot at once; the row and its view log
 * stay as the record of who shared what, when and until when.
 */
export const reportShareLink = pgTable(
	"report_share_link",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		/** The creator's employee record; their project report access decides whether the link lives. */
		creatorEmployeeId: uuid("creator_employee_id").references(() => employee.id, {
			onDelete: "set null",
		}),
		kind: text("kind").$type<ReportShareLinkKind>().notNull(),
		/** The project of a project link; kept null once the project is deleted. */
		projectId: uuid("project_id").references(() => project.id, { onDelete: "set null" }),
		/** The customer of a customer link; kept null once the customer is deleted. */
		customerId: uuid("customer_id").references(() => customer.id, { onDelete: "set null" }),
		/** Every project in the snapshot: the creator must keep seeing all of them. */
		projectIds: uuid("project_ids").array().notNull(),
		fromDay: date("from_day", { mode: "string" }).notNull(),
		toDay: date("to_day", { mode: "string" }).notNull(),
		figures: text("figures").$type<(typeof REPORT_SHARE_LINK_FIGURES)[number]>().notNull(),
		includeEmployees: boolean("include_employees").notNull().default(false),
		/** The creator's UI language, for recipients whose browser language Z8 lacks. */
		creatorLocale: text("creator_locale").notNull(),
		/** Hex SHA-256 of the URL token; the token itself is never stored. */
		tokenDigest: text("token_digest").notNull(),
		tokenHashVersion: text("token_hash_version").notNull(),
		/** The shared snapshot; deleted (null) as soon as the link expires or is revoked. */
		snapshot: jsonb("snapshot").$type<SharedSnapshot>(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		/** Who revoked it; null for an expiry or a revocation nobody acted for. */
		revokedBy: text("revoked_by").references(() => user.id, { onDelete: "set null" }),
		revokeReason: text("revoke_reason").$type<ReportShareLinkRevokeReason>(),
	},
	(table) => [
		uniqueIndex("reportShareLink_tokenDigest_idx").on(table.tokenDigest),
		index("reportShareLink_org_createdAt_idx").on(table.organizationId, table.createdAt),
		index("reportShareLink_org_project_idx").on(table.organizationId, table.projectId),
		index("reportShareLink_org_customer_idx").on(table.organizationId, table.customerId),
		index("reportShareLink_live_idx")
			.on(table.expiresAt)
			.where(sql`${table.revokedAt} IS NULL`),
		check("report_share_link_kind_check", sql.raw(textIn("kind", REPORT_SHARE_LINK_KINDS))),
		check(
			"report_share_link_figures_check",
			sql.raw(textIn("figures", REPORT_SHARE_LINK_FIGURES)),
		),
		check("report_share_link_range_check", sql`${table.toDay} >= ${table.fromDay}`),
		check("report_share_link_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
		check(
			"report_share_link_revocation_check",
			sql.raw(
				`(revoked_at IS NULL AND revoke_reason IS NULL AND revoked_by IS NULL) OR (revoked_at IS NOT NULL AND snapshot IS NULL AND ${textIn("revoke_reason", REPORT_SHARE_LINK_REVOKE_REASONS)})`,
			),
		),
	],
);

/**
 * One recipient view of a report share link. Kept for the audit-log lifetime
 * (365 days); not written to the audit log, whose rows need a Z8 user.
 */
export const reportShareLinkView = pgTable(
	"report_share_link_view",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		linkId: uuid("link_id")
			.notNull()
			.references(() => reportShareLink.id, { onDelete: "cascade" }),
		viewedAt: timestamp("viewed_at", { withTimezone: true }).defaultNow().notNull(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
	},
	(table) => [
		index("reportShareLinkView_link_viewedAt_idx").on(table.linkId, table.viewedAt),
		index("reportShareLinkView_org_idx").on(table.organizationId),
		index("reportShareLinkView_viewedAt_idx").on(table.viewedAt),
	],
);

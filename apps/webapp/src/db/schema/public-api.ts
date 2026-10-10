import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organization } from "../auth-schema";

// ============================================
// PUBLIC API (#763)
// ============================================

/**
 * The key request log: one row per Public API request made with an identified
 * API key, successful or refused. Kept for 90 days. Never attributed to the
 * key creator (ADR 0001). The key id has no foreign key, so a revoked key's
 * requests stay until they age out.
 */
export const publicApiRequestLog = pgTable(
	"public_api_request_log",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		apiKeyId: text("api_key_id").notNull(),
		method: text("method").notNull(),
		/** The route template, such as `/api/v1/employees`. */
		route: text("route").notNull(),
		status: integer("status").notNull(),
		/** Rows a successful list or read returned; null for refusals. */
		rowCount: integer("row_count"),
		ipAddress: text("ip_address"),
		requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("publicApiRequestLog_org_key_requestedAt_idx").on(
			table.organizationId,
			table.apiKeyId,
			table.requestedAt,
		),
		index("publicApiRequestLog_requestedAt_idx").on(table.requestedAt),
	],
);

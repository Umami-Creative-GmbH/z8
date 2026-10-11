import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organization } from "../auth-schema";

// ============================================
// PUBLIC API (#763)
// ============================================

/** How a key request reached Z8: the Public API or the MCP server (#795). */
export const KEY_REQUEST_CHANNELS = ["api", "mcp"] as const;
export type KeyRequestChannel = (typeof KEY_REQUEST_CHANNELS)[number];

/**
 * The key request log: one row per Public API request made with an identified
 * API key, successful or refused, and one per MCP tool call. Kept for 90 days.
 * Never attributed to the key creator (ADR 0001). The key id has no foreign
 * key, so a revoked key's requests stay until they age out.
 */
export const publicApiRequestLog = pgTable(
	"public_api_request_log",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		apiKeyId: text("api_key_id").notNull(),
		channel: text("channel", { enum: KEY_REQUEST_CHANNELS }).default("api").notNull(),
		method: text("method").notNull(),
		/** The route template, such as `/api/v1/employees`; for an MCP tool call, the tool's route. */
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
		check("public_api_request_log_channel_check", sql`${table.channel} in ('api', 'mcp')`),
	],
);

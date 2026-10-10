import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	foreignKey,
	index,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { location } from "./organization";

/**
 * A kiosk (#859, glossary "Kiosk"): a shared device enrolled to one location of
 * an organization. It acts as itself, never as a signed-in user.
 *
 * - The device authenticates with a long-lived device token; only its SHA-256
 *   is stored (`token_hash`). Rotating or re-pairing replaces or clears it, so
 *   the old token stops resolving. A revoked kiosk keeps its hash so the device
 *   can be told it was revoked rather than unknown.
 * - A pairing code is single-use and expires after about ten minutes; only its
 *   SHA-256 is stored, together with its expiry and the admin who issued it.
 * - `timezone` is the kiosk's IANA zone, the device zone of its clock commands.
 * - `board_enabled` switches the who-is-in board on the kiosk (off by default).
 */
export const kiosk = pgTable(
	"kiosk",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		locationId: uuid("location_id").notNull(),
		name: text("name").notNull(),
		timezone: text("timezone").notNull(),
		boardEnabled: boolean("board_enabled").default(false).notNull(),
		tokenHash: text("token_hash"),
		pairedAt: timestamp("paired_at", { withTimezone: true }),
		pairingCodeHash: text("pairing_code_hash"),
		pairingCodeExpiresAt: timestamp("pairing_code_expires_at", { withTimezone: true }),
		pairingCodeIssuedBy: text("pairing_code_issued_by").references(() => user.id, {
			onDelete: "set null",
		}),
		lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		revokedBy: text("revoked_by").references(() => user.id, { onDelete: "set null" }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
		updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		foreignKey({
			name: "kiosk_location_fk",
			columns: [table.locationId, table.organizationId],
			foreignColumns: [location.id, location.organizationId],
		}).onDelete("cascade"),
		unique("kiosk_id_organizationId_idx").on(table.id, table.organizationId),
		uniqueIndex("kiosk_tokenHash_idx").on(table.tokenHash),
		uniqueIndex("kiosk_pairingCodeHash_idx").on(table.pairingCodeHash),
		index("kiosk_organizationId_idx").on(table.organizationId),
		check(
			"kiosk_pairing_code_check",
			sql`(${table.pairingCodeHash} IS NULL) = (${table.pairingCodeExpiresAt} IS NULL)`,
		),
		check("kiosk_name_check", sql`char_length(btrim(${table.name})) BETWEEN 1 AND 100`),
	],
);

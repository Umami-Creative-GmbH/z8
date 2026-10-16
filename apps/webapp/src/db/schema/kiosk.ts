import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	foreignKey,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { employee, location } from "./organization";

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
 * - `offline_mode_enabled` (#1287, spec #885) lets the kiosk keep clocking
 *   through an outage (off by default). It takes effect only while the
 *   organization is adopted (`append` admission, ADR 0002): switching it on in a
 *   `legacy` organization is refused, and a pilot rollback leaves it stored but
 *   ineffective.
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
		offlineModeEnabled: boolean("offline_mode_enabled").default(false).notNull(),
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

/**
 * A kiosk device token that was rotated away (#1289, spec #885). Rotating clears
 * `kiosk.token_hash`, so the old token would otherwise read as never known; an
 * offline kiosk still sends its queued commands with it, and Z8 refuses and
 * lists them for the kiosk (whatever instant they claim). Only the SHA-256 is
 * kept. A revoked kiosk keeps its hash on `kiosk` and needs no row here.
 */
export const kioskRetiredToken = pgTable(
	"kiosk_retired_token",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		kioskId: uuid("kiosk_id").notNull(),
		tokenHash: text("token_hash").notNull(),
		retiredAt: timestamp("retired_at", { withTimezone: true }).notNull(),
		retiredBy: text("retired_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		foreignKey({
			name: "kiosk_retired_token_kiosk_fk",
			columns: [table.kioskId, table.organizationId],
			foreignColumns: [kiosk.id, kiosk.organizationId],
		}).onDelete("cascade"),
		uniqueIndex("kioskRetiredToken_tokenHash_idx").on(table.tokenHash),
		index("kioskRetiredToken_kiosk_idx").on(table.organizationId, table.kioskId),
	],
);

/**
 * A frozen kiosk clock command Z8 refused on arrival (#1290, spec #885): kept
 * once per kiosk and operation, so a resend is answered from it (no second PIN
 * check) and the kiosk's lookup can say it was refused. Owners and admins see
 * them in the kiosk settings; the employee, or a kiosk-only employee's
 * managers, were notified when it was recorded. Never holds the PIN: `command`
 * is the frozen command without it.
 *
 * - `employee_id` is set when the command named an employee of the
 *   organization (the claimed id is in `command`).
 * - `claimed_at` is the instant the command claims; `refused_at` when Z8
 *   refused it. `reason` is a `KioskFrozenRefusalReason`, `detail` its details
 *   as the kiosk was answered.
 */
export const kioskFrozenRefusal = pgTable(
	"kiosk_frozen_refusal",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		kioskId: uuid("kiosk_id").notNull(),
		operationId: uuid("operation_id").notNull(),
		employeeId: uuid("employee_id"),
		action: text("action").notNull(),
		claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull(),
		timeSource: text("time_source").notNull(),
		reason: text("reason").notNull(),
		detail: jsonb("detail").$type<Record<string, unknown>>().default({}).notNull(),
		command: jsonb("command").$type<unknown>().notNull(),
		refusedAt: timestamp("refused_at", { withTimezone: true }).notNull(),
	},
	(table) => [
		foreignKey({
			name: "kiosk_frozen_refusal_kiosk_fk",
			columns: [table.kioskId, table.organizationId],
			foreignColumns: [kiosk.id, kiosk.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "kiosk_frozen_refusal_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		uniqueIndex("kioskFrozenRefusal_operation_idx").on(
			table.organizationId,
			table.kioskId,
			table.operationId,
		),
		index("kioskFrozenRefusal_organization_refusedAt_idx").on(
			table.organizationId,
			table.refusedAt,
		),
		index("kioskFrozenRefusal_employee_idx").on(table.employeeId),
	],
);

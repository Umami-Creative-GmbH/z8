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
 * - `badge_scanner_enabled` (#1366, spec #889) accepts employee kiosk badges
 *   from an attached keyboard-style QR scanner on the kiosk's home screen, in
 *   place of the PIN (off by default). It grants nothing on its own: every badge
 *   action still needs the active kiosk, a current badge and an assigned,
 *   active employee.
 * - `badge_camera_enabled` (#1367, spec #889) accepts the same badges read with
 *   the kiosk's own camera ("Scan badge" on the home screen), off by default and
 *   independent of the scanner switch. Frames are decoded on the device and
 *   never leave it.
 * - `nfc_fob_reader_enabled` (#1505, spec #1358, ADR 0014) accepts kiosk fob
 *   serial numbers typed by an attached keyboard-style NFC reader on the
 *   kiosk's home screen (off by default, independent of both badge switches).
 *   A fob only selects the employee; the kiosk PIN still proves.
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
		badgeScannerEnabled: boolean("badge_scanner_enabled").default(false).notNull(),
		badgeCameraEnabled: boolean("badge_camera_enabled").default(false).notNull(),
		nfcFobReaderEnabled: boolean("nfc_fob_reader_enabled").default(false).notNull(),
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
 * The values a refused frozen kiosk command may record. They mirror
 * `KIOSK_FROZEN_ACTIONS`, `KIOSK_TIME_SOURCES` and `KIOSK_FROZEN_REFUSAL_REASONS`
 * (`lib/time-tracking/kiosk/frozen-command.ts`); a unit test keeps them equal.
 */
export const KIOSK_REFUSAL_ACTIONS = [
	"clock_in",
	"clock_out",
	"start_break",
	"resume_break",
] as const;
export const KIOSK_REFUSAL_TIME_SOURCES = ["server_anchor", "device_clock"] as const;
export const KIOSK_REFUSAL_REASONS = [
	"kiosk_revoked",
	"kiosk_rotated",
	"contact_unverifiable",
	"not_adopted",
	"admission_window",
	"clock_out_of_bounds",
	"employee_not_assigned",
	"pin_unsealable",
	"no_pin",
	"wrong_pin",
	"pin_locked",
	"already_clocked_in",
	"occupancy_conflict",
	"not_clocked_in",
	"target_unknown",
	"target_not_active",
	"already_on_break",
	"on_break",
	"no_break_in_progress",
	"invalid_interval",
	"under_review",
	"holiday_blocked",
	"month_closed",
	"append_review_required",
	"billing_required",
	"collision",
	"access_denied",
	"invalid_command",
] as const;

const sqlList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

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
 * - `claimed_at` is the instant the command claims, `timezone` the zone the
 *   kiosk recorded it in (it is shown in that zone); `refused_at` when Z8
 *   refused it. `reason` is a `KioskFrozenRefusalReason`, `detail` its details
 *   as the kiosk was answered.
 * - `notified_at` is set once the notification was handed over (or nobody was
 *   to be told); while it is null, the kiosk's next question about the command
 *   sends it again.
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
		action: text("action", { enum: KIOSK_REFUSAL_ACTIONS }).notNull(),
		claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull(),
		timezone: text("timezone").notNull(),
		timeSource: text("time_source", { enum: KIOSK_REFUSAL_TIME_SOURCES }).notNull(),
		reason: text("reason", { enum: KIOSK_REFUSAL_REASONS }).notNull(),
		detail: jsonb("detail").$type<Record<string, unknown>>().default({}).notNull(),
		command: jsonb("command").$type<unknown>().notNull(),
		refusedAt: timestamp("refused_at", { withTimezone: true }).notNull(),
		notifiedAt: timestamp("notified_at", { withTimezone: true }),
	},
	(table) => [
		check(
			"kiosk_frozen_refusal_action_check",
			sql.raw(`"action" in (${sqlList(KIOSK_REFUSAL_ACTIONS)})`),
		),
		check(
			"kiosk_frozen_refusal_time_source_check",
			sql.raw(`"time_source" in (${sqlList(KIOSK_REFUSAL_TIME_SOURCES)})`),
		),
		check(
			"kiosk_frozen_refusal_reason_check",
			sql.raw(`"reason" in (${sqlList(KIOSK_REFUSAL_REASONS)})`),
		),
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

/**
 * The actions and states a kiosk clock attempt may record. The actions mirror
 * `KIOSK_CLOCK_ACTIONS` (`lib/time-tracking/kiosk/protocol.ts`); a unit test
 * keeps them equal.
 */
export const KIOSK_ATTEMPT_ACTIONS = [
	"clock_in",
	"clock_out",
	"break",
	"start_break",
	"resume_break",
] as const;
export const KIOSK_ATTEMPT_STATES = ["committed", "not_recorded"] as const;

/**
 * How an online kiosk clock attempt ended (#1363, spec #889), once per kiosk and
 * operation: the terminal record that lets a kiosk which lost an action's reply
 * learn what became of it without running anything again.
 *
 * - `committed`: written by Clocking inside the action's own work transaction
 *   (both admissions), so it exists exactly when the work does. It keeps the
 *   employee, the action and the event's time (`event_at` in `event_zone`) as the
 *   reply named them.
 * - `not_recorded`: written by the kiosk's outcome lookup when no attempt is
 *   recorded yet. It closes the operation for good: the original request, should
 *   it still be on its way, finds the row and rolls back. Whichever writes the
 *   row first wins; the unique index makes the other wait for it.
 *
 * Holds no PIN, badge or command, nothing that could run the action again.
 */
export const kioskClockAttempt = pgTable(
	"kiosk_clock_attempt",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		kioskId: uuid("kiosk_id").notNull(),
		operationId: uuid("operation_id").notNull(),
		state: text("state", { enum: KIOSK_ATTEMPT_STATES }).notNull(),
		employeeId: uuid("employee_id"),
		action: text("action", { enum: KIOSK_ATTEMPT_ACTIONS }),
		eventAt: timestamp("event_at", { withTimezone: true }),
		eventZone: text("event_zone"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		check(
			"kiosk_clock_attempt_state_check",
			sql.raw(`"state" in (${sqlList(KIOSK_ATTEMPT_STATES)})`),
		),
		check(
			"kiosk_clock_attempt_action_check",
			sql.raw(`"action" is null or "action" in (${sqlList(KIOSK_ATTEMPT_ACTIONS)})`),
		),
		check(
			"kiosk_clock_attempt_committed_check",
			sql.raw(
				`"state" <> 'committed' or ("employee_id" is not null and "action" is not null and "event_at" is not null and "event_zone" is not null)`,
			),
		),
		foreignKey({
			name: "kiosk_clock_attempt_kiosk_fk",
			columns: [table.kioskId, table.organizationId],
			foreignColumns: [kiosk.id, kiosk.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "kiosk_clock_attempt_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		uniqueIndex("kioskClockAttempt_operation_idx").on(
			table.organizationId,
			table.kioskId,
			table.operationId,
		),
		index("kioskClockAttempt_employee_idx").on(table.employeeId),
	],
);

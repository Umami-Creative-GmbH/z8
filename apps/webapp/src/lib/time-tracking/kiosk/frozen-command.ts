/**
 * Frozen kiosk clock commands (#1289, spec #885, Time Tracking glossary "Offline
 * kiosk clocking", ADR 0011): kiosk clocking that happened while the kiosk was
 * offline and reaches Z8 later. Pure and client-safe: the kiosk page (#1292)
 * builds the same shapes this module parses.
 *
 * The kiosk freezes each command once, before its first attempt, and sends the
 * same submission bytes on every retry (`POST /api/kiosk/commands` with its
 * `x-kiosk-token`). A submission has three parts:
 *
 * - `command`: the frozen command (version 1). Z8 stores it verbatim as the
 *   committed receipt's command, so its bytes are the operation's fingerprint: the
 *   same bytes replay the committed outcome, other bytes under the same
 *   `operationId` are a collision. It never holds the PIN.
 * - `pin`: the employee's PIN sealed so that only Z8 can open it (`pin-seal.ts`),
 *   bound to this kiosk, employee and operation.
 * - `contact`: the signed contact anchor of the kiosk's last server contact before
 *   the command (the session's `offline.contact`), returned unchanged.
 *
 * Time: `server_anchor` instants are the anchor's `serverTime` plus elapsed time
 * from a monotonic clock; after an offline restart the kiosk uses the device
 * clock (`device_clock`), which Z8 accepts only between the anchor and arrival.
 */
import { z } from "zod";
import type { KioskTimeSource } from "../clocking/types";
import { isValidIanaTimezone } from "../timezone-capture";
import {
	breakVehicleUseSchema,
	clockInVehicleUseSchema,
	clockOutVehicleUseSchema,
} from "../vehicle-use/clock-vehicle-use";

/** The frozen kiosk command version this server accepts. */
export const KIOSK_FROZEN_COMMAND_VERSION = 1;

/** Where a command's instant came from; recorded on the entry's provenance. */
export const KIOSK_TIME_SOURCES = [
	"server_anchor",
	"device_clock",
] as const satisfies readonly KioskTimeSource[];

/**
 * What an employee does offline. `clock_out` also ends the day while on a break
 * (at the break's start). The online `break` of a number of minutes has no frozen
 * form.
 */
export const KIOSK_FROZEN_ACTIONS = [
	"clock_in",
	"clock_out",
	"start_break",
	"resume_break",
] as const;
export type KioskFrozenAction = (typeof KIOSK_FROZEN_ACTIONS)[number];

/** The one operation ID representation: a lowercase canonical UUID. */
const operationId = z
	.string()
	.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
/** A UTC instant with at most millisecond precision, ending in `Z`. */
const utcInstant = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/)
	.refine((value) => !Number.isNaN(Date.parse(value)));
const ianaZone = z.string().refine((value) => isValidIanaTimezone(value));
const base64url = z.string().regex(/^[A-Za-z0-9_-]+$/);
const preserve = z.strictObject({ kind: z.literal("preserve") });

const commandFields = {
	version: z.literal(KIOSK_FROZEN_COMMAND_VERSION),
	operationId,
	/** The kiosk that queued the command; must be the kiosk whose token sends it. */
	kioskId: uuid,
	employeeId: uuid,
	/** UTC instant the employee acted at. */
	occurredAt: utcInstant,
	timeSource: z.enum(KIOSK_TIME_SOURCES),
	/** The kiosk's zone as the kiosk knew it; Z8 captures the entry in the kiosk's current zone. */
	timezone: ianaZone,
};

/** The work a clock-out closes: a known period, or the period its own queued clock-in or resume starts. */
const closeTarget = z.union([
	z.strictObject({ workPeriodId: uuid }),
	z.strictObject({ clockInOperationId: operationId }),
]);

const frozenKioskCommandSchema = z.discriminatedUnion("action", [
	z.strictObject({
		...commandFields,
		action: z.literal("clock_in"),
		/** Kiosk work is always at the office, as online. */
		workLocationType: z.literal("office"),
		vehicleUse: clockInVehicleUseSchema.optional(),
	}),
	z.strictObject({
		...commandFields,
		action: z.literal("clock_out"),
		target: closeTarget,
		project: preserve,
		workCategory: preserve,
		vehicleUse: clockOutVehicleUseSchema.optional(),
	}),
	z.strictObject({ ...commandFields, action: z.literal("start_break") }),
	z.strictObject({
		...commandFields,
		action: z.literal("resume_break"),
		/**
		 * The break start the kiosk believed it resumed (its own queued start, or the
		 * cached state's `breakSince`/`breakZone`). Z8 ends the break it recorded;
		 * this keeps the receipt's `breakStart`, which a retried resume reads.
		 */
		breakStart: z.strictObject({ at: utcInstant, timezone: ianaZone }),
		vehicleUse: breakVehicleUseSchema.optional(),
	}),
]);

export type KioskFrozenCommand = z.infer<typeof frozenKioskCommandSchema>;

/** An ECIES-sealed PIN (`pin-seal.ts`); each part base64url without padding. */
export const sealedKioskPinSchema = z.strictObject({
	v: z.literal(1),
	/** The sealing key's id (`KioskSealingKey.kid`). */
	kid: base64url,
	/** The ephemeral P-256 public key, raw uncompressed (65 bytes). */
	epk: base64url,
	/** The AES-GCM nonce (12 bytes). */
	iv: base64url,
	/** The AES-GCM ciphertext of the PIN's UTF-8 digits, with its 16-byte tag appended. */
	ct: base64url,
});
export type SealedKioskPin = z.infer<typeof sealedKioskPinSchema>;

/**
 * A signed contact anchor: Z8's time at one contact of a kiosk, signed for that
 * kiosk and device token. The kiosk keeps it opaque and returns it unchanged.
 */
export const kioskContactAnchorSchema = z.strictObject({
	serverTime: utcInstant,
	proof: base64url,
});
export type KioskContactAnchor = z.infer<typeof kioskContactAnchorSchema>;

const submissionSchema = z.strictObject({
	command: z.unknown(),
	pin: sealedKioskPinSchema,
	contact: kioskContactAnchorSchema,
});

export type KioskFrozenSubmission = {
	command: KioskFrozenCommand;
	pin: SealedKioskPin;
	contact: KioskContactAnchor;
};

export type ParsedKioskFrozenSubmission =
	| { ok: true; submission: KioskFrozenSubmission }
	| { ok: false; code: "invalid_request" | "unsupported_version" };

/** Parses a submission; an unknown command version is told apart from a malformed one. */
export function parseKioskFrozenSubmission(body: unknown): ParsedKioskFrozenSubmission {
	const envelope = submissionSchema.safeParse(body);
	if (!envelope.success) return { ok: false, code: "invalid_request" };
	const { command } = envelope.data;
	if (
		command &&
		typeof command === "object" &&
		(command as { version?: unknown }).version !== KIOSK_FROZEN_COMMAND_VERSION
	) {
		return { ok: false, code: "unsupported_version" };
	}
	const parsed = frozenKioskCommandSchema.safeParse(command);
	if (!parsed.success) return { ok: false, code: "invalid_request" };
	return {
		ok: true,
		submission: { command: parsed.data, pin: envelope.data.pin, contact: envelope.data.contact },
	};
}

/**
 * Why Z8 refused a frozen kiosk command. Stable codes the kiosk shows and the
 * refusal record keeps; nothing was written for the command.
 *
 * Kiosk and transport:
 * - `kiosk_revoked`: the kiosk was revoked (whatever instant the command claims).
 * - `kiosk_rotated`: the kiosk's token was rotated since the command's contact.
 * - `contact_unverifiable`: the contact anchor is not one Z8 signed for this kiosk.
 * - `not_adopted`: the organization has not adopted append admission (ADR 0002).
 * Time:
 * - `admission_window`: outside the delayed window (7 days back, 5 minutes ahead); `reason` too_old/in_future.
 * - `clock_out_of_bounds`: before the kiosk's last contact, or a device-clock instant after arrival.
 * Who:
 * - `employee_not_assigned`: not an active employee of the organization assigned to the kiosk's location now.
 * - `pin_unsealable`: the sealed PIN cannot be opened for this command (other key, kiosk, employee or operation).
 * - `no_pin`, `wrong_pin`: checked against the employee's current PIN.
 * - `pin_locked`: the employee was locked out at the command's instant, or this attempt locked them; `lockedUntil`.
 * Clocking (as online): `already_clocked_in` (`since`), `occupancy_conflict`, `not_clocked_in`,
 * `target_unknown`, `target_not_active`, `already_on_break`, `on_break`, `no_break_in_progress`,
 * `invalid_interval`, `under_review` (`review`), `holiday_blocked` (`holidayName`),
 * `month_closed` (`month`), `append_review_required`, `billing_required` (`reason`),
 * `collision` (the operation ID names other work), `access_denied` (the kiosk's or the employee's
 * standing changed while the command was judged), `invalid_command`.
 */
export const KIOSK_FROZEN_REFUSAL_REASONS = [
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
export type KioskFrozenRefusalReason = (typeof KIOSK_FROZEN_REFUSAL_REASONS)[number];

/**
 * `POST /api/kiosk/commands` answers:
 * - 201 `executed` / 200 `replayed`: committed once; `at` is when it took effect
 *   (a day ended on a break ends at the break's start), absent on a replay
 *   answered from the stored outcome.
 * - 4xx `refused` with `code` (`KioskFrozenRefusalReason`) and its details; never
 *   resend it.
 * - 500 `unknown`: it may or may not have committed; look it up, then resend the
 *   same bytes.
 * - 400 `invalid_request` / 422 `unsupported_version` (no `outcome`): malformed;
 *   401 `kiosk_unknown`: the token was never this kiosk's or any.
 */
export type KioskFrozenCommandReply =
	| {
			outcome: "executed" | "replayed";
			operationId: string;
			action: KioskFrozenAction;
			at?: { instant: string; zone: string };
	  }
	| ({ outcome: "refused"; operationId: string; code: KioskFrozenRefusalReason } & Record<
			string,
			unknown
	  >)
	| { outcome: "unknown"; operationId: string };

/**
 * `GET /api/kiosk/commands/{operationId}`: what became of a command this kiosk
 * sent. `committed` (with its action), `refused` (as recorded), `not_committed`
 * (resending the same bytes is safe) or `conflict` (other work holds the identity).
 */
export type KioskFrozenCommandLookup =
	| { outcome: "committed"; operationId: string; action: KioskFrozenAction }
	| ({ outcome: "refused"; operationId: string; code: KioskFrozenRefusalReason } & Record<
			string,
			unknown
	  >)
	| { outcome: "not_committed" | "conflict"; operationId: string };

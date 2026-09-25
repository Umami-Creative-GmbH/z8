/**
 * Frozen direct-HTTP clock commands (#275 / T11, resolution #263 §1–§5).
 *
 * A client freezes one versioned command before its first attempt and resends
 * exactly that command, under the same identity, until it learns the outcome.
 * The server stores the command verbatim in the completed-work receipt, so a
 * retry must be byte-for-byte the same JSON value. This module owns only the
 * pure contract: the version 2 shape, elapsed-age admission and the context
 * assertion check. Execution lives with the completed-work operations.
 */
import { z } from "zod";
import type { Instant } from "@/lib/datetime/temporal-core";
import { isValidIanaTimezone } from "./timezone-capture";
import { WORK_LOCATION_TYPES } from "./work-location";

export const CLOCK_COMMAND_VERSION = 2;

const MINUTE_MILLISECONDS = 60_000;
/** Elapsed-instant windows, not local calendar days (#263 §5). */
export const CLOCK_COMMAND_ADMISSION_WINDOWS = {
	immediate: {
		pastMilliseconds: 5 * MINUTE_MILLISECONDS,
		futureMilliseconds: 5 * MINUTE_MILLISECONDS,
	},
	delayed: {
		pastMilliseconds: 7 * 24 * 60 * MINUTE_MILLISECONDS,
		futureMilliseconds: 5 * MINUTE_MILLISECONDS,
	},
} as const;

export type ClockCommandAdmission = keyof typeof CLOCK_COMMAND_ADMISSION_WINDOWS;

// One exact representation per value: lowercase canonical UUIDs, UTC instants with
// at most millisecond precision, and an origin without a path.
/** The one accepted operation ID representation: a lowercase canonical UUID. */
export const CLOCK_COMMAND_OPERATION_ID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const operationId = z.string().regex(CLOCK_COMMAND_OPERATION_ID);
const utcInstant = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/)
	.refine((value) => !Number.isNaN(Date.parse(value)));
const origin = z.string().refine((value) => {
	try {
		return new URL(value).origin === value;
	} catch {
		return false;
	}
});
const attribution = z.discriminatedUnion("kind", [
	z.strictObject({ kind: z.literal("preserve") }),
	z.strictObject({ kind: z.literal("clear") }),
	z.strictObject({ kind: z.literal("replace"), id: z.uuid() }),
]);

/** Consistency assertions captured with the action. They never grant access. */
const contextAssertion = z.strictObject({
	userId: z.string().min(1),
	organizationId: z.string().min(1),
	employeeId: z.uuid(),
	server: origin,
});

const commandFields = {
	version: z.literal(CLOCK_COMMAND_VERSION),
	operationId,
	admission: z.enum(["immediate", "delayed"]),
	/** Original UTC event instant. The server derives the endpoint offset. */
	occurredAt: utcInstant,
	/** Event-time IANA zone captured by the client. */
	timezone: z.string().refine((value) => isValidIanaTimezone(value)),
	context: contextAssertion,
};

const clockCommandSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		...commandFields,
		kind: z.literal("clock_in"),
		workLocationType: z.enum(WORK_LOCATION_TYPES),
	}),
	z.strictObject({
		...commandFields,
		kind: z.literal("clock_out"),
		/** A known period, or the queued clock-in operation that creates it. */
		target: z.union([
			z.strictObject({ workPeriodId: z.uuid() }),
			z.strictObject({ clockInOperationId: operationId }),
		]),
		project: attribution,
		workCategory: attribution,
	}),
]);

export type ClockCommand = z.infer<typeof clockCommandSchema>;
export type ClockInCommand = Extract<ClockCommand, { kind: "clock_in" }>;
export type ClockOutCommand = Extract<ClockCommand, { kind: "clock_out" }>;
export type ClockCommandContext = ClockCommand["context"];

export type ParsedClockCommand =
	| { ok: true; command: ClockCommand }
	| { ok: false; code: "unsupported_version" | "invalid_command" };

export function parseClockCommand(body: unknown): ParsedClockCommand {
	if (
		!body ||
		typeof body !== "object" ||
		(body as { version?: unknown }).version !== CLOCK_COMMAND_VERSION
	) {
		return body && typeof body === "object"
			? { ok: false, code: "unsupported_version" }
			: { ok: false, code: "invalid_command" };
	}
	const parsed = clockCommandSchema.safeParse(body);
	return parsed.success
		? { ok: true, command: parsed.data }
		: { ok: false, code: "invalid_command" };
}

export type ClockCommandAgeAdmission =
	| { admitted: true }
	| { admitted: false; reason: "too_old" | "in_future" };

/** Fresh admission only; matching committed replay never reaches this check. */
export function admitClockCommandAge(
	mode: ClockCommandAdmission,
	occurredAt: Instant,
	serverNow: Instant,
): ClockCommandAgeAdmission {
	const window = CLOCK_COMMAND_ADMISSION_WINDOWS[mode];
	const ageMilliseconds = Number(serverNow.epochNanoseconds - occurredAt.epochNanoseconds) / 1e6;
	if (ageMilliseconds > window.pastMilliseconds) return { admitted: false, reason: "too_old" };
	if (-ageMilliseconds > window.futureMilliseconds) {
		return { admitted: false, reason: "in_future" };
	}
	return { admitted: true };
}

export type ClockCommandAuthority = {
	userId: string;
	organizationId: string;
	employeeId: string;
	/** The public origin that served this request; null when it is unknown. */
	server: string | null;
};

/** Every asserted field that disagrees with server-derived authority. */
export function verifyClockCommandContext(
	asserted: ClockCommandContext,
	authority: ClockCommandAuthority,
): (keyof ClockCommandContext)[] {
	return (["userId", "organizationId", "employeeId", "server"] as const).filter(
		(field) => asserted[field] !== authority[field],
	);
}

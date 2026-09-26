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
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
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

/** A known period, or the queued clock-in (or break) operation that creates it. */
const closeTarget = z.union([
	z.strictObject({ workPeriodId: z.uuid() }),
	z.strictObject({ clockInOperationId: operationId }),
]);

const ianaZone = z.string().refine((value) => isValidIanaTimezone(value));
/** One device observation: the UTC wall clock and a monotonic reading taken together. */
const observation = z.strictObject({
	utc: utcInstant,
	/** Process-relative monotonic milliseconds; only differences carry meaning. */
	monotonicMs: z.number().int().nonnegative(),
});
const zonedObservation = z.strictObject({ ...observation.shape, timezone: ianaZone });

const clockCommandSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		...commandFields,
		kind: z.literal("clock_in"),
		workLocationType: z.enum(WORK_LOCATION_TYPES),
	}),
	z.strictObject({
		...commandFields,
		kind: z.literal("clock_out"),
		target: closeTarget,
		project: attribution,
		workCategory: attribution,
	}),
	/**
	 * A confirmed desktop idle break (#281, resolution #263 §8): one atomic
	 * operation closes the target at the estimated idle start and resumes at the
	 * detected return. `occurredAt`/`timezone` are the detected return, never the
	 * later confirmation; `breakStart` is the close endpoint with the zone
	 * observed when idleness was detected. The observations explain both.
	 */
	z.strictObject({
		...commandFields,
		kind: z.literal("break"),
		target: closeTarget,
		/** Location of the resumed work. */
		workLocationType: z.enum(WORK_LOCATION_TYPES),
		breakStart: z.strictObject({ at: utcInstant, timezone: ianaZone }),
		observations: z.strictObject({
			/** The last input before idleness: the estimated idle start. */
			lastActivity: observation,
			/** When the idle threshold was noticed, with the zone observed then. */
			idleDetected: zonedObservation,
			/** The first input after idleness, with the zone observed then. */
			returnDetected: zonedObservation,
			/** When the employee confirmed the break. */
			confirmed: observation,
		}),
	}),
]);

export type ClockCommand = z.infer<typeof clockCommandSchema>;
export type ClockInCommand = Extract<ClockCommand, { kind: "clock_in" }>;
export type ClockOutCommand = Extract<ClockCommand, { kind: "clock_out" }>;
export type BreakCommand = Extract<ClockCommand, { kind: "break" }>;
export type ClockCommandContext = ClockCommand["context"];

type BreakObservation = keyof BreakCommand["observations"];
const BREAK_OBSERVATION_ORDER = [
	"lastActivity",
	"idleDetected",
	"returnDetected",
	"confirmed",
] as const satisfies readonly BreakObservation[];

/**
 * The endpoints must be exactly the observations they claim to be: the close is
 * the last input with the idle-detection zone, the resume is the detected return
 * with its own zone. The monotonic clock never runs backwards.
 */
function breakEndpointsMatchObservations(command: BreakCommand): boolean {
	const { observations: seen } = command;
	return (
		command.breakStart.at === seen.lastActivity.utc &&
		command.breakStart.timezone === seen.idleDetected.timezone &&
		command.occurredAt === seen.returnDetected.utc &&
		command.timezone === seen.returnDetected.timezone &&
		BREAK_OBSERVATION_ORDER.every(
			(name, index) =>
				index === 0 ||
				seen[name].monotonicMs >= seen[BREAK_OBSERVATION_ORDER[index - 1]].monotonicMs,
		) &&
		seen.lastActivity.monotonicMs < seen.returnDetected.monotonicMs
	);
}

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
	if (!parsed.success) return { ok: false, code: "invalid_command" };
	if (parsed.data.kind === "break" && !breakEndpointsMatchObservations(parsed.data)) {
		return { ok: false, code: "invalid_command" };
	}
	return { ok: true, command: parsed.data };
}

/**
 * Wall-clock and monotonic elapsed time between consecutive observations may
 * differ by two seconds plus one millisecond per monotonic second (clock slew).
 * The desktop applies the same rule before it freezes a break.
 */
export const BREAK_CLOCK_TOLERANCE = { baseMilliseconds: 2_000, perSecondMilliseconds: 1 } as const;

export type BreakClockDiscontinuity = { code: "clock_discontinuity"; from: BreakObservation };

/**
 * A wall-clock change while idle leaves the proposed interval uncertain, so the
 * break needs a reviewed correction instead (#263 §8). Returns the first
 * observation after which the clocks disagree, or null.
 */
export function checkBreakClockContinuity(command: BreakCommand): BreakClockDiscontinuity | null {
	const seen = command.observations;
	for (let index = 1; index < BREAK_OBSERVATION_ORDER.length; index += 1) {
		const from = BREAK_OBSERVATION_ORDER[index - 1];
		const to = BREAK_OBSERVATION_ORDER[index];
		const monotonic = seen[to].monotonicMs - seen[from].monotonicMs;
		const wall =
			parseInstant(seen[to].utc).epochMilliseconds - parseInstant(seen[from].utc).epochMilliseconds;
		const allowed =
			BREAK_CLOCK_TOLERANCE.baseMilliseconds +
			Math.floor(monotonic / 1000) * BREAK_CLOCK_TOLERANCE.perSecondMilliseconds;
		if (Math.abs(wall - monotonic) > allowed) return { code: "clock_discontinuity", from };
	}
	return null;
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

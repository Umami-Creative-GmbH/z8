/**
 * Strict versioned manual time-entry commands (#308 / T44, designs #254 and #258).
 *
 * Pure interpretation shared by the browser (to offer explicit occurrence choices)
 * and the server's protected preparation (to interpret the frozen command). The
 * server derives instants and offsets itself; the displayed offsets a browser
 * sends are comparison evidence, never authority.
 */
import { Temporal } from "temporal-polyfill";
import type { Instant, PlainDate } from "@/lib/datetime/temporal-core";
import { isValidIanaTimeZone } from "@/lib/timezone/validation";
import { deriveWorkDurationMinutes } from "./work-duration";

export const MANUAL_TIME_ENTRY_COMMAND_VERSION = 2;

export type ManualEndpointOccurrence = "earlier" | "later";
export type ManualEndpointName = "clockIn" | "clockOut";

/** One endpoint as the user confirmed it. */
export type ManualEndpointCommand = {
	/** Minute-precision local wall-clock time, `HH:mm`. */
	time: string;
	/** Required exactly when the wall time is repeated in the zone. */
	occurrence: ManualEndpointOccurrence | null;
	/** The UTC offset the form showed for this endpoint; comparison evidence only. */
	displayedOffsetMinutes: number;
};

/**
 * `target`: the target's effective zone the form displayed (employee →
 * organization → UTC). `browser`: a self entry continued once in the validated
 * browser zone, which then governs interpretation and capture.
 */
export type ManualZoneBasis = "target" | "browser";

/** The frozen version-2 command. Every field is a claim the server revalidates. */
export type ManualTimeEntryCommand = {
	version: typeof MANUAL_TIME_ENTRY_COMMAND_VERSION;
	submissionId: string;
	targetEmployeeId: string;
	/** One strict local date, `YYYY-MM-DD`; there is no end date. */
	date: string;
	clockIn: ManualEndpointCommand;
	clockOut: ManualEndpointCommand;
	zone: { basis: ManualZoneBasis; timezone: string };
	browserTimezone: string | null;
	reason: string;
	projectId: string | null;
	workCategoryId: string | null;
};

export type ManualCommandRejection = { reason: "invalid_command"; field: string };

const COMMAND_KEYS = [
	"version",
	"submissionId",
	"targetEmployeeId",
	"date",
	"clockIn",
	"clockOut",
	"zone",
	"browserTimezone",
	"reason",
	"projectId",
	"workCategoryId",
] as const;
const ENDPOINT_KEYS = ["time", "occurrence", "displayedOffsetMinutes"] as const;
const ZONE_KEYS = ["basis", "timezone"] as const;
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STRICT_DATE = /^\d{4}-\d{2}-\d{2}$/;
const STRICT_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** IANA offsets stay within ±18 hours. */
const MAX_OFFSET_MINUTES = 18 * 60;

class InvalidCommandField extends Error {
	constructor(readonly field: string) {
		super(`Invalid manual command field: ${field}`);
	}
}

function exactRecord(value: unknown, keys: readonly string[], field: string) {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Object.prototype
	) {
		throw new InvalidCommandField(field);
	}
	const own = Object.keys(value);
	if (own.length !== keys.length || own.some((key) => !keys.includes(key))) {
		throw new InvalidCommandField(field);
	}
	return value as Record<string, unknown>;
}

function isStrictDate(value: unknown): value is string {
	if (typeof value !== "string" || !STRICT_DATE.test(value)) return false;
	try {
		Temporal.PlainDate.from(value, { overflow: "reject" });
		return true;
	} catch {
		return false;
	}
}

function nullableId(value: unknown, field: string): string | null {
	if (value === null) return null;
	if (typeof value !== "string" || value.length === 0) throw new InvalidCommandField(field);
	return value;
}

function parseEndpoint(value: unknown, field: ManualEndpointName): ManualEndpointCommand {
	const record = exactRecord(value, ENDPOINT_KEYS, field);
	if (typeof record.time !== "string" || !STRICT_TIME.test(record.time)) {
		throw new InvalidCommandField(`${field}.time`);
	}
	if (
		record.occurrence !== null &&
		record.occurrence !== "earlier" &&
		record.occurrence !== "later"
	) {
		throw new InvalidCommandField(`${field}.occurrence`);
	}
	const offset = record.displayedOffsetMinutes;
	if (!Number.isSafeInteger(offset) || Math.abs(offset as number) > MAX_OFFSET_MINUTES) {
		throw new InvalidCommandField(`${field}.displayedOffsetMinutes`);
	}
	return {
		time: record.time,
		occurrence: record.occurrence,
		displayedOffsetMinutes: offset as number,
	};
}

/**
 * Strictly parse a version-2 command: exact keys, a valid calendar date,
 * `HH:mm` endpoints, a named IANA zone and a nonblank reason. The result is the
 * submitted representation, unchanged; normalization happens in interpretation.
 */
export function parseManualTimeEntryCommand(
	value: unknown,
):
	| { ok: true; command: ManualTimeEntryCommand }
	| { ok: false; rejection: ManualCommandRejection } {
	try {
		const record = exactRecord(value, COMMAND_KEYS, "command");
		if (record.version !== MANUAL_TIME_ENTRY_COMMAND_VERSION) {
			throw new InvalidCommandField("version");
		}
		if (typeof record.submissionId !== "string" || !CANONICAL_UUID.test(record.submissionId)) {
			throw new InvalidCommandField("submissionId");
		}
		if (typeof record.targetEmployeeId !== "string" || record.targetEmployeeId.length === 0) {
			throw new InvalidCommandField("targetEmployeeId");
		}
		if (!isStrictDate(record.date)) throw new InvalidCommandField("date");
		const clockIn = parseEndpoint(record.clockIn, "clockIn");
		const clockOut = parseEndpoint(record.clockOut, "clockOut");
		const zone = exactRecord(record.zone, ZONE_KEYS, "zone");
		if (zone.basis !== "target" && zone.basis !== "browser") {
			throw new InvalidCommandField("zone.basis");
		}
		if (!isValidIanaTimeZone(zone.timezone)) throw new InvalidCommandField("zone.timezone");
		const browserTimezone = record.browserTimezone;
		if (browserTimezone !== null && !isValidIanaTimeZone(browserTimezone)) {
			throw new InvalidCommandField("browserTimezone");
		}
		// Continuing once in the browser zone means exactly that zone.
		if (zone.basis === "browser" && zone.timezone !== browserTimezone) {
			throw new InvalidCommandField("zone.basis");
		}
		if (typeof record.reason !== "string" || record.reason.trim().length === 0) {
			throw new InvalidCommandField("reason");
		}
		return {
			ok: true,
			command: {
				version: MANUAL_TIME_ENTRY_COMMAND_VERSION,
				submissionId: record.submissionId,
				targetEmployeeId: record.targetEmployeeId,
				date: record.date,
				clockIn,
				clockOut,
				zone: { basis: zone.basis, timezone: zone.timezone as string },
				browserTimezone: browserTimezone as string | null,
				reason: record.reason,
				projectId: nullableId(record.projectId, "projectId"),
				workCategoryId: nullableId(record.workCategoryId, "workCategoryId"),
			},
		};
	} catch (error) {
		if (!(error instanceof InvalidCommandField)) throw error;
		return { ok: false, rejection: { reason: "invalid_command", field: error.field } };
	}
}

/** How one local wall-clock time maps to instants in a zone. */
export type ManualWallTime =
	| { kind: "unique"; offsetMinutes: number }
	| { kind: "gap" }
	| { kind: "ambiguous"; earlierOffsetMinutes: number; laterOffsetMinutes: number };

function offsetMinutes(value: InstanceType<typeof Temporal.ZonedDateTime>): number {
	return value.offsetNanoseconds / 60_000_000_000;
}

function zonedCandidates(date: string, time: string, timezone: string) {
	const wall = Temporal.PlainDate.from(date).toPlainDateTime(Temporal.PlainTime.from(time));
	return {
		wall,
		earlier: wall.toZonedDateTime(timezone, { disambiguation: "earlier" }),
		later: wall.toZonedDateTime(timezone, { disambiguation: "later" }),
	};
}

/**
 * Classify a date and `HH:mm` in an IANA zone: one instant, none (a
 * spring-forward gap), or two (a repeated autumn hour) with their UTC offsets.
 */
export function describeManualWallTime(
	date: string,
	time: string,
	timezone: string,
): ManualWallTime {
	const { wall, earlier, later } = zonedCandidates(date, time, timezone);
	if (Temporal.Instant.compare(earlier.toInstant(), later.toInstant()) === 0) {
		return { kind: "unique", offsetMinutes: offsetMinutes(earlier) };
	}
	// In a gap both candidates are shifted away from the requested wall time.
	if (!Temporal.PlainDateTime.from(earlier.toPlainDateTime()).equals(wall)) {
		return { kind: "gap" };
	}
	return {
		kind: "ambiguous",
		earlierOffsetMinutes: offsetMinutes(earlier),
		laterOffsetMinutes: offsetMinutes(later),
	};
}

/** Where the target's effective zone came from; revalidated, not reconfirmed. */
export type ManualTargetZoneSource = "employee" | "organization" | "default";

/** The capture provenance recorded on both endpoints. */
export type ManualCaptureSource = "browser" | "user_setting" | "manager_target_user_setting";

export type ManualZoneRejection =
	| ManualCommandRejection
	| { reason: "reconfirmation_required"; detail: "zone_changed"; timezone: string };

/**
 * The zone that governs parsing, date validation and capture. A target-basis
 * command must name the authoritative effective zone; a different IANA zone needs
 * reconfirmation even when the offsets agree. Only self entries may continue once
 * in the browser zone; on-behalf entries never use the actor's browser.
 */
export function resolveManualInterpretationZone(input: {
	command: ManualTimeEntryCommand;
	isOwnEntry: boolean;
	targetZone: { timezone: string; source: ManualTargetZoneSource };
}):
	| { ok: true; timezone: string; captureSource: ManualCaptureSource }
	| { ok: false; rejection: ManualZoneRejection } {
	const { command, isOwnEntry, targetZone } = input;
	if (command.zone.basis === "browser") {
		if (!isOwnEntry) {
			return { ok: false, rejection: { reason: "invalid_command", field: "zone.basis" } };
		}
		return { ok: true, timezone: command.zone.timezone, captureSource: "browser" };
	}
	if (command.zone.timezone !== targetZone.timezone) {
		return {
			ok: false,
			rejection: {
				reason: "reconfirmation_required",
				detail: "zone_changed",
				timezone: targetZone.timezone,
			},
		};
	}
	return {
		ok: true,
		timezone: targetZone.timezone,
		captureSource: !isOwnEntry
			? "manager_target_user_setting"
			: command.browserTimezone === targetZone.timezone
				? "browser"
				: "user_setting",
	};
}

export type ManualIntervalRejection =
	| { reason: "nonexistent_time"; endpoint: ManualEndpointName }
	| {
			reason: "occurrence_required";
			endpoint: ManualEndpointName;
			earlierOffsetMinutes: number;
			laterOffsetMinutes: number;
	  }
	| {
			reason: "reconfirmation_required";
			detail: "ambiguity_changed" | "offset_mismatch";
			endpoint: ManualEndpointName;
	  }
	| { reason: "nonpositive_interval" }
	| { reason: "future_endpoint" }
	| { reason: "interval_too_long" };

export type ManualInterval = {
	ok: true;
	start: Instant;
	end: Instant;
	/** Each endpoint's own offset at its actual instant. */
	startOffsetMinutes: number;
	endOffsetMinutes: number;
	/** Exact UTC elapsed time, half-up to whole minutes. */
	durationMinutes: number;
};

const MAX_ELAPSED_NANOSECONDS = BigInt(24 * 60 * 60) * BigInt(1_000_000_000);

function interpretEndpoint(
	date: string,
	endpoint: ManualEndpointCommand,
	name: ManualEndpointName,
	timezone: string,
):
	| { ok: true; instant: Instant; offsetMinutes: number }
	| { ok: false; rejection: ManualIntervalRejection } {
	const wallTime = describeManualWallTime(date, endpoint.time, timezone);
	if (wallTime.kind === "gap") {
		return { ok: false, rejection: { reason: "nonexistent_time", endpoint: name } };
	}
	if (wallTime.kind === "ambiguous" && endpoint.occurrence === null) {
		return {
			ok: false,
			rejection: {
				reason: "occurrence_required",
				endpoint: name,
				earlierOffsetMinutes: wallTime.earlierOffsetMinutes,
				laterOffsetMinutes: wallTime.laterOffsetMinutes,
			},
		};
	}
	if (wallTime.kind === "unique" && endpoint.occurrence !== null) {
		return {
			ok: false,
			rejection: { reason: "reconfirmation_required", detail: "ambiguity_changed", endpoint: name },
		};
	}
	const zoned = zonedCandidates(date, endpoint.time, timezone)[
		endpoint.occurrence === "later" ? "later" : "earlier"
	];
	const offset = offsetMinutes(zoned);
	if (offset !== endpoint.displayedOffsetMinutes) {
		return {
			ok: false,
			rejection: { reason: "reconfirmation_required", detail: "offset_mismatch", endpoint: name },
		};
	}
	return { ok: true, instant: zoned.toInstant(), offsetMinutes: offset };
}

/**
 * Interpret both endpoints in the governing zone at one evaluation instant.
 * Gaps are rejected, repeated times need their explicit occurrence, and a
 * changed ambiguity or displayed offset needs reconfirmation. UTC order decides
 * the interval: it must be positive, end no later than `now` and span at most
 * 24 elapsed hours. Nothing is trimmed, split or shifted.
 */
export function interpretManualInterval(input: {
	command: ManualTimeEntryCommand;
	timezone: string;
	now: Instant;
}): ManualInterval | { ok: false; rejection: ManualIntervalRejection } {
	const { command, timezone, now } = input;
	const start = interpretEndpoint(command.date, command.clockIn, "clockIn", timezone);
	if (!start.ok) return start;
	const end = interpretEndpoint(command.date, command.clockOut, "clockOut", timezone);
	if (!end.ok) return end;
	const elapsed = end.instant.epochNanoseconds - start.instant.epochNanoseconds;
	if (elapsed <= BigInt(0)) return { ok: false, rejection: { reason: "nonpositive_interval" } };
	if (Temporal.Instant.compare(end.instant, now) > 0) {
		return { ok: false, rejection: { reason: "future_endpoint" } };
	}
	if (elapsed > MAX_ELAPSED_NANOSECONDS) {
		return { ok: false, rejection: { reason: "interval_too_long" } };
	}
	return {
		ok: true,
		start: start.instant,
		end: end.instant,
		startOffsetMinutes: start.offsetMinutes,
		endOffsetMinutes: end.offsetMinutes,
		durationMinutes: deriveWorkDurationMinutes(start.instant, end.instant),
	};
}

/**
 * Local dates in the effective zone with positive intersection with the
 * half-open `[start, end)`: an end exactly at local midnight does not occupy
 * the following date.
 */
export function manualOccupiedLocalDates(
	start: Instant,
	end: Instant,
	timezone: string,
): PlainDate[] {
	const zonedEnd = end.toZonedDateTimeISO(timezone);
	let last = zonedEnd.toPlainDate();
	if (Temporal.ZonedDateTime.compare(zonedEnd, zonedEnd.startOfDay()) === 0) {
		last = last.subtract({ days: 1 });
	}
	const dates: PlainDate[] = [];
	for (
		let date = start.toZonedDateTimeISO(timezone).toPlainDate();
		Temporal.PlainDate.compare(date, last) <= 0;
		date = date.add({ days: 1 })
	) {
		dates.push(date);
	}
	return dates;
}

/** Calendar days from the end instant's local date to `now`'s local date in the zone. */
export function manualCalendarDaysBack(end: Instant, now: Instant, timezone: string): number {
	return end
		.toZonedDateTimeISO(timezone)
		.toPlainDate()
		.until(now.toZonedDateTimeISO(timezone).toPlainDate(), { largestUnit: "days" }).days;
}

/** The effective change policy's manual-relevant values. */
export type ManualChangePolicy = {
	selfServiceDays: number;
	approvalDays: number;
	noApprovalRequired: boolean;
};

export type ManualApprovalIntent =
	| {
			intent: "direct";
			reason: "on_behalf" | "owner_admin_self" | "no_policy" | "trust_mode" | "within_self_service";
	  }
	| { intent: "approval"; reason: "within_approval_window" | "beyond_approval_window" };

/**
 * Manual approval intent (#254 §5). Thresholds are inclusive calendar days.
 * Authorized on-behalf entries and owner/admin self entries are exempt. Beyond
 * the approval window the generic policy says `forbidden`; for manual entries
 * only that age-based outcome becomes approval intent. Authorization failures
 * never reach this function.
 */
export function evaluateManualApprovalIntent(input: {
	exemption: "on_behalf" | "owner_admin_self" | null;
	policy: ManualChangePolicy | null;
	daysBack: number;
}): ManualApprovalIntent {
	const { exemption, policy, daysBack } = input;
	if (exemption) return { intent: "direct", reason: exemption };
	if (!policy) return { intent: "direct", reason: "no_policy" };
	if (policy.noApprovalRequired) return { intent: "direct", reason: "trust_mode" };
	if (daysBack <= policy.selfServiceDays)
		return { intent: "direct", reason: "within_self_service" };
	if (daysBack <= policy.selfServiceDays + policy.approvalDays) {
		return { intent: "approval", reason: "within_approval_window" };
	}
	return { intent: "approval", reason: "beyond_approval_window" };
}

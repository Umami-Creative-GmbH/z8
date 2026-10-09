import "server-only";

import { positionStamp } from "@/db/schema";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import { acceptsPositionStamp, resolvePositionCapture } from "../position-capture/resolver";
import type { PositionCaptureClient } from "../position-capture/store";
import { stampablePosition } from "./position-stamp-eligibility";
import type { ClockCommand } from "./types";

type Executed<Result> = Extract<Result, { disposition: "executed" }>;

/**
 * Keeps the position a clock command carried as a position stamp on the clock
 * event's entry (#826), when the command's own writes executed: a replay never
 * stamps. Runs inside the command's work transaction, after its writes, and
 * returns the result unchanged.
 */
export async function stampExecutedClockEvent<Result extends { disposition: string }>(
	db: PositionCaptureClient,
	command: ClockCommand,
	result: Result,
	stamp: {
		/** The clock event's instant: the stamp's capture time. */
		eventInstant: Instant;
		/** The entry the device's position belongs to. */
		entryIdOf: (executed: Executed<Result>) => string;
	},
): Promise<Result> {
	if (result.disposition === "executed") {
		const executed = result as Executed<Result>;
		await recordPositionStamp(db, command, {
			timeEntryId: stamp.entryIdOf(executed),
			eventInstant: stamp.eventInstant,
		});
	}
	return result;
}

/**
 * The capture check reads the settings and the employee's consent rows
 * `FOR SHARE`, so a concurrent configuration change or withdrawal waits for this
 * commit (and a withdrawal's deletion then removes the stamp) or is seen here.
 *
 * Anything else silently drops the position: an ineligible command, capture off,
 * no active consent to the current notice, or consent given after the event.
 * Nothing records why. Returns whether a stamp was stored. An eligible command is
 * never on behalf, so its subject is the employee who carried the device.
 */
async function recordPositionStamp(
	db: PositionCaptureClient,
	command: ClockCommand,
	event: { timeEntryId: string; eventInstant: Instant },
): Promise<boolean> {
	const position = stampablePosition(command);
	if (!position) return false;
	const { organizationId } = command;
	const { employeeId } = command.subject;
	const resolution = await resolvePositionCapture(
		db,
		{ organizationId, employeeId },
		{ lock: "share" },
	);
	if (!acceptsPositionStamp(resolution, event.eventInstant)) return false;
	if (resolution.consent.kind !== "active") return false;
	await db.insert(positionStamp).values({
		organizationId,
		employeeId,
		timeEntryId: event.timeEntryId,
		consentId: resolution.consent.consentId,
		latitude: position.latitude,
		longitude: position.longitude,
		accuracyMeters: position.accuracyMeters,
		fixedAt: dateFromInstant(position.fixedAt),
		capturedAt: dateFromInstant(event.eventInstant),
		purgeAt: dateFromInstant(event.eventInstant.add({ hours: 24 * resolution.retentionDays })),
	});
	return true;
}

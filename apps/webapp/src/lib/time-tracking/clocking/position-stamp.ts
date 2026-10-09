import "server-only";

import { positionStamp } from "@/db/schema";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import { acceptsPositionStamp, resolvePositionCapture } from "../position-capture/resolver";
import type { PositionCaptureClient } from "../position-capture/store";
import { stampablePosition } from "./position-stamp-eligibility";
import type { ClockCommand } from "./types";

/**
 * Keeps the position a clock command carried as a position stamp on the clock
 * event's entry (#826), inside the command's work transaction and after its
 * writes. The capture check reads the settings and the employee's consent rows
 * `FOR SHARE`, so a concurrent configuration change or withdrawal waits for this
 * commit (and a withdrawal's deletion then removes the stamp) or is seen here.
 *
 * Anything else silently drops the position: an ineligible command, capture off,
 * no active consent to the current notice, or consent given after the event.
 * Nothing records why. Returns whether a stamp was stored.
 */
export async function recordPositionStamp(
	db: PositionCaptureClient,
	input: {
		command: ClockCommand;
		organizationId: string;
		employeeId: string;
		timeEntryId: string;
		/** The clock event's instant: the stamp's capture time. */
		eventInstant: Instant;
	},
): Promise<boolean> {
	const position = stampablePosition(input.command);
	if (!position) return false;
	const resolution = await resolvePositionCapture(
		db,
		{ organizationId: input.organizationId, employeeId: input.employeeId },
		{ lock: "share" },
	);
	if (!acceptsPositionStamp(resolution, input.eventInstant)) return false;
	if (resolution.consent.kind !== "active") return false;
	await db.insert(positionStamp).values({
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		timeEntryId: input.timeEntryId,
		consentId: resolution.consent.consentId,
		latitude: position.latitude,
		longitude: position.longitude,
		accuracyMeters: position.accuracyMeters,
		fixedAt: dateFromInstant(position.fixedAt),
		capturedAt: dateFromInstant(input.eventInstant),
		purgeAt: dateFromInstant(input.eventInstant.add({ hours: 24 * resolution.retentionDays })),
	});
	return true;
}

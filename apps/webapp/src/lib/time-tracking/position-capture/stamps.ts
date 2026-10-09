import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { positionStamp } from "@/db/schema";
import { type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import type { ClockPosition } from "../clocking/types";
import type { PositionCaptureClient } from "./store";

/** One stored position stamp (#826), as later slices read it: the clock event's position and more. */
export type PositionStampRecord = ClockPosition & {
	id: string;
	employeeId: string;
	timeEntryId: string;
	consentId: string;
	capturedAt: Instant;
	purgeAt: Instant;
};

/**
 * The stamps of the given clock events, filtered by organization. A raw read:
 * it checks no viewer permission and writes no access log, which the display
 * (#831) does before calling it.
 */
export async function readPositionStampsForEntries(
	db: Pick<PositionCaptureClient, "select">,
	input: { organizationId: string; timeEntryIds: readonly string[] },
): Promise<PositionStampRecord[]> {
	if (input.timeEntryIds.length === 0) return [];
	const rows = await db
		.select()
		.from(positionStamp)
		.where(
			and(
				eq(positionStamp.organizationId, input.organizationId),
				inArray(positionStamp.timeEntryId, [...input.timeEntryIds]),
			),
		);
	return rows.map((row) => ({
		id: row.id,
		employeeId: row.employeeId,
		timeEntryId: row.timeEntryId,
		consentId: row.consentId,
		latitude: row.latitude,
		longitude: row.longitude,
		accuracyMeters: row.accuracyMeters,
		fixedAt: instantFromDate(row.fixedAt),
		capturedAt: instantFromDate(row.capturedAt),
		purgeAt: instantFromDate(row.purgeAt),
	}));
}

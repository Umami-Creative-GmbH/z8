import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { timeEntry, workPeriod } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import type { ClockPosition } from "../clocking/types";
import type { WorkTransactionDatabase } from "../work-transaction";
import { recordPositionStampAccess } from "./access-log";
import { readPositionStampsForEntries } from "./stamps";
import type { PositionCaptureClient } from "./store";
import { loadPositionStampViewer, positionStampAccess } from "./viewer";

/** A stamp as shown on a work period's detail. No address, no map. */
export type WorkPeriodPositionStamp = ClockPosition & {
	/** Which end of the work period the stamped clock event is. */
	event: "clock_in" | "clock_out";
	/** The instant of the clock event the position was recorded with. */
	eventAt: Instant;
	/** That clock event's own UTC offset, for event-local display. */
	eventUtcOffsetMinutes: number;
	/**
	 * The event's times were corrected after capture: the stamp belongs to the
	 * original event, not to the times the work period now shows.
	 */
	originalEvent: boolean;
};

export type WorkPeriodPositions =
	| { kind: "not_found" }
	| { kind: "forbidden" }
	| {
			kind: "shown";
			employeeId: string;
			/** Whether an access-log entry was written. */
			logged: boolean;
			stamps: WorkPeriodPositionStamp[];
	  };

/** Correction chains are short; the bound only guards against a malformed cycle. */
const MAX_CORRECTION_DEPTH = 32;

/**
 * "Show positions" on one work period (#831): checks the viewer (`./viewer`),
 * reads the stamps of the period's clock-in and clock-out events, including the
 * original events a correction replaced, and writes one access-log entry when
 * the viewer is not the employee, all in one transaction.
 */
export async function showWorkPeriodPositions(
	database: WorkTransactionDatabase,
	input: { organizationId: string; viewerUserId: string; workPeriodId: string; now: Instant },
): Promise<WorkPeriodPositions> {
	return database.transaction(async (tx) => {
		const [period] = await tx
			.select({
				id: workPeriod.id,
				employeeId: workPeriod.employeeId,
				clockInId: workPeriod.clockInId,
				clockOutId: workPeriod.clockOutId,
				startTime: workPeriod.startTime,
				endTime: workPeriod.endTime,
				deletedAt: workPeriod.deletedAt,
			})
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.id, input.workPeriodId),
					eq(workPeriod.organizationId, input.organizationId),
				),
			)
			.limit(1);
		if (!period || period.deletedAt) return { kind: "not_found" };

		const viewer = await loadPositionStampViewer(tx, {
			organizationId: input.organizationId,
			userId: input.viewerUserId,
		});
		const access = positionStampAccess(viewer, period.employeeId);
		if (!access.allowed) return { kind: "forbidden" };

		const ends = [
			{ event: "clock_in" as const, entryId: period.clockInId, shownAt: period.startTime },
			...(period.clockOutId
				? [{ event: "clock_out" as const, entryId: period.clockOutId, shownAt: period.endTime }]
				: []),
		];
		const chains = await correctionChains(
			tx,
			input.organizationId,
			ends.map((end) => end.entryId),
		);
		const stamps = await readPositionStampsForEntries(tx, {
			organizationId: input.organizationId,
			timeEntryIds: [...chains.entries.keys()],
		});

		const shown: WorkPeriodPositionStamp[] = [];
		for (const end of ends) {
			const chain = chains.chainOf.get(end.entryId) ?? [];
			for (const entryId of chain) {
				const stamp = stamps.find(
					(candidate) =>
						candidate.timeEntryId === entryId && candidate.employeeId === period.employeeId,
				);
				const entry = chains.entries.get(entryId);
				if (!stamp || !entry) continue;
				shown.push({
					event: end.event,
					latitude: stamp.latitude,
					longitude: stamp.longitude,
					accuracyMeters: stamp.accuracyMeters,
					fixedAt: stamp.fixedAt,
					eventAt: instantFromDate(entry.timestamp),
					eventUtcOffsetMinutes: entry.utcOffsetMinutes,
					originalEvent:
						entryId !== end.entryId ||
						entry.isSuperseded ||
						end.shownAt === null ||
						entry.timestamp.getTime() !== end.shownAt.getTime(),
				});
				break;
			}
		}

		if (access.logged) {
			await recordPositionStampAccess(tx, {
				organizationId: input.organizationId,
				viewerUserId: input.viewerUserId,
				kind: "work_period_detail",
				workPeriodIds: [period.id],
				subjectEmployeeIds: [period.employeeId],
				accessedAt: input.now,
			});
		}
		return { kind: "shown", employeeId: period.employeeId, logged: access.logged, stamps: shown };
	});
}

type ChainEntry = {
	id: string;
	timestamp: Date;
	utcOffsetMinutes: number;
	isSuperseded: boolean;
	replacesEntryId: string | null;
};

/**
 * For each current clock event, the event itself followed by the events it
 * replaced, newest first. A correction writes a new entry with
 * `replacesEntryId`, so a stamp stays on the original entry.
 */
async function correctionChains(
	tx: Pick<PositionCaptureClient, "select">,
	organizationId: string,
	entryIds: readonly string[],
): Promise<{ entries: Map<string, ChainEntry>; chainOf: Map<string, string[]> }> {
	const entries = new Map<string, ChainEntry>();
	let pending = [...new Set(entryIds)];
	for (let depth = 0; pending.length > 0 && depth < MAX_CORRECTION_DEPTH; depth++) {
		const rows = await tx
			.select({
				id: timeEntry.id,
				timestamp: timeEntry.timestamp,
				utcOffsetMinutes: timeEntry.utcOffsetMinutes,
				isSuperseded: timeEntry.isSuperseded,
				replacesEntryId: timeEntry.replacesEntryId,
			})
			.from(timeEntry)
			.where(and(eq(timeEntry.organizationId, organizationId), inArray(timeEntry.id, pending)));
		for (const row of rows) entries.set(row.id, row);
		pending = rows
			.map((row) => row.replacesEntryId)
			.filter((id): id is string => id !== null && !entries.has(id));
	}

	const chainOf = new Map<string, string[]>();
	for (const start of entryIds) {
		const chain: string[] = [];
		let current: string | null = start;
		while (current && entries.has(current) && !chain.includes(current)) {
			chain.push(current);
			current = entries.get(current)?.replacesEntryId ?? null;
		}
		chainOf.set(start, chain);
	}
	return { entries, chainOf };
}

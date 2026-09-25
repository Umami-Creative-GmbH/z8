/**
 * Symmetric fresh-work occupancy (#256 §4). Every interval-changing writer
 * checks its resulting interval against the employee's other recorded work
 * under the shared employee coordination:
 *
 * - nondeleted approved, pending and rejected work occupies its half-open interval;
 * - active work occupies from its start onward, including starts on earlier days;
 * - adjacency is valid, and empty intervals (deletion sentinels) occupy nothing;
 * - a replacement excludes exactly the sources it atomically replaces;
 * - a period and its linked canonical record are one segment, so only canonical
 *   work without any period link is read as an independent occupant.
 */
import { and, eq, gt, isNotNull, isNull, lt, notExists, notInArray, or } from "drizzle-orm";
import type { db } from "@/db";
import { timeRecord, workPeriod } from "@/db/schema";
import {
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
} from "@/lib/datetime/temporal-core";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type OccupancyClient = Pick<Transaction, "select">;

export interface WorkOccupant {
	kind: "work_period" | "time_record";
	id: string;
	startAt: Instant;
	/** Null for active work. */
	endAt: Instant | null;
}

export interface OccupancyInterval {
	startAt: Instant;
	endAt: Instant;
}

export class WorkOccupancyConflictError extends Error {
	constructor(readonly conflicts: readonly WorkOccupant[]) {
		super("The time range overlaps other recorded work");
		this.name = "WorkOccupancyConflictError";
	}
}

/** Occupants intersecting the half-open interval, ordered by start. */
export function findOccupancyConflicts(
	interval: OccupancyInterval,
	occupants: readonly WorkOccupant[],
): WorkOccupant[] {
	return occupants
		.filter(
			(occupant) =>
				(occupant.endAt === null || compareInstants(occupant.endAt, occupant.startAt) > 0) &&
				compareInstants(occupant.startAt, interval.endAt) < 0 &&
				(occupant.endAt === null || compareInstants(occupant.endAt, interval.startAt) > 0),
		)
		.sort((left, right) => compareInstants(left.startAt, right.startAt));
}

/**
 * Reads the employee's recorded work that may intersect the interval. The caller
 * holds the employee coordination lock, so a competing writer cannot insert
 * into the interval until this transaction ends.
 */
export async function loadWorkOccupants(
	client: OccupancyClient,
	input: {
		organizationId: string;
		employeeId: string;
		interval: OccupancyInterval;
		/** Sources this operation replaces atomically. */
		excludeWorkPeriodIds: readonly string[];
	},
): Promise<WorkOccupant[]> {
	const start = dateFromInstant(input.interval.startAt);
	const end = dateFromInstant(input.interval.endAt);
	const periods = await client
		.select({ id: workPeriod.id, startAt: workPeriod.startTime, endAt: workPeriod.endTime })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.employeeId, input.employeeId),
				isNull(workPeriod.deletedAt),
				lt(workPeriod.startTime, end),
				or(isNull(workPeriod.endTime), gt(workPeriod.endTime, start)),
				...(input.excludeWorkPeriodIds.length
					? [notInArray(workPeriod.id, [...input.excludeWorkPeriodIds])]
					: []),
			),
		);
	// Canonical work linked from any period, deleted or not, is that period's
	// representation; only canonical-native work occupies independently.
	const nativeRecords = await client
		.select({ id: timeRecord.id, startAt: timeRecord.startAt, endAt: timeRecord.endAt })
		.from(timeRecord)
		.where(
			and(
				eq(timeRecord.organizationId, input.organizationId),
				eq(timeRecord.employeeId, input.employeeId),
				eq(timeRecord.recordKind, "work"),
				lt(timeRecord.startAt, end),
				or(isNull(timeRecord.endAt), gt(timeRecord.endAt, start)),
				notExists(
					client
						.select({ id: workPeriod.id })
						.from(workPeriod)
						.where(
							and(
								eq(workPeriod.organizationId, input.organizationId),
								isNotNull(workPeriod.canonicalRecordId),
								eq(workPeriod.canonicalRecordId, timeRecord.id),
							),
						),
				),
			),
		);
	return findOccupancyConflicts(input.interval, [
		...periods.map((row) => ({
			kind: "work_period" as const,
			id: row.id,
			startAt: instantFromDate(row.startAt),
			endAt: row.endAt ? instantFromDate(row.endAt) : null,
		})),
		...nativeRecords.map((row) => ({
			kind: "time_record" as const,
			id: row.id,
			startAt: instantFromDate(row.startAt),
			endAt: row.endAt ? instantFromDate(row.endAt) : null,
		})),
	]);
}

export async function assertWorkOccupancyFree(
	client: OccupancyClient,
	input: Parameters<typeof loadWorkOccupants>[1],
): Promise<void> {
	const conflicts = await loadWorkOccupants(client, input);
	if (conflicts.length > 0) throw new WorkOccupancyConflictError(conflicts);
}

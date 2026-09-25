/**
 * Shared completed-work occupancy (#256 §4), used by every adopted fresh writer
 * that creates an interval (reviewed imports #284, manual entry #308).
 */
import { and, asc, eq, gt, isNull, lt, notExists, or, type SQL } from "drizzle-orm";
import { timeRecord, workPeriod } from "@/db/schema";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import type { WorkTransactionScope } from "./work-transaction";

/** One recorded work interval that intersects a requested interval. */
export type WorkOccupant = {
	kind: "work_period" | "time_record";
	id: string;
	startAt: string;
	endAt: string | null;
};

/**
 * Symmetric half-open occupancy (#256 §4): nondeleted work in any approval state
 * occupies its interval, active work from its start onward, adjacency is valid.
 * A canonical record linked from any period is represented by that period, so
 * one work segment is never counted twice and deleted work stays excluded.
 */
export async function findWorkOccupants(
	tx: WorkTransactionScope["db"],
	scope: { organizationId: string; employeeId: string },
	start: Instant,
	end: Instant | null,
): Promise<WorkOccupant[]> {
	const startAt = dateFromInstant(start);
	const endAt = end ? dateFromInstant(end) : null;
	const overlaps = (
		startColumn: typeof workPeriod.startTime | typeof timeRecord.startAt,
		endColumn: typeof workPeriod.endTime | typeof timeRecord.endAt,
	): SQL[] => [
		...(endAt ? [lt(startColumn, endAt)] : []),
		or(isNull(endColumn), gt(endColumn, startAt)) as SQL,
	];
	const periods = await tx
		.select({ id: workPeriod.id, startAt: workPeriod.startTime, endAt: workPeriod.endTime })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, scope.organizationId),
				eq(workPeriod.employeeId, scope.employeeId),
				isNull(workPeriod.deletedAt),
				...overlaps(workPeriod.startTime, workPeriod.endTime),
			),
		)
		.orderBy(asc(workPeriod.startTime), asc(workPeriod.id));
	const records = await tx
		.select({ id: timeRecord.id, startAt: timeRecord.startAt, endAt: timeRecord.endAt })
		.from(timeRecord)
		.where(
			and(
				eq(timeRecord.organizationId, scope.organizationId),
				eq(timeRecord.employeeId, scope.employeeId),
				eq(timeRecord.recordKind, "work"),
				...overlaps(timeRecord.startAt, timeRecord.endAt),
				notExists(
					tx
						.select({ id: workPeriod.id })
						.from(workPeriod)
						.where(
							and(
								eq(workPeriod.organizationId, scope.organizationId),
								eq(workPeriod.canonicalRecordId, timeRecord.id),
							),
						),
				),
			),
		)
		.orderBy(asc(timeRecord.startAt), asc(timeRecord.id));
	return [
		...periods.map((row) => ({ kind: "work_period" as const, ...occupantInterval(row) })),
		...records.map((row) => ({ kind: "time_record" as const, ...occupantInterval(row) })),
	];
}

function occupantInterval(row: { id: string; startAt: Date; endAt: Date | null }) {
	return {
		id: row.id,
		startAt: row.startAt.toISOString(),
		endAt: row.endAt?.toISOString() ?? null,
	};
}

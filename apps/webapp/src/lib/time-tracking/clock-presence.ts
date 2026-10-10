import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { workPeriod } from "@/db/schema";
import type { WorkTransactionClient } from "./web-clock-out-transaction";

/**
 * Who is clocked in and who is on a break in progress (#861, Time Tracking ADR
 * 0007), for a set of employees of one organization. An employee without live
 * work is clocked out and has no row. Callers decide who may see whom.
 */
export type ClockPresence = {
	employeeId: string;
	/** The live work, which an open break interrupts without ending it. */
	workPeriodId: string;
	/** Where the live work started. */
	workSince: Date;
	state: "clocked_in" | "on_break";
	/** Where the open break started; null unless on break. */
	breakSince: Date | null;
	/** The zone observed where the break started; null unless on break. */
	breakZone: string | null;
};

export async function readClockPresence(
	client: Pick<WorkTransactionClient, "select">,
	scope: { organizationId: string; employeeIds: readonly string[] },
): Promise<ClockPresence[]> {
	if (scope.employeeIds.length === 0) return [];
	const rows = await client
		.select({
			employeeId: workPeriod.employeeId,
			workPeriodId: workPeriod.id,
			workSince: workPeriod.startTime,
			breakSince: workPeriod.breakStartedAt,
			breakZone: workPeriod.breakStartedZone,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, scope.organizationId),
				inArray(workPeriod.employeeId, [...scope.employeeIds]),
				eq(workPeriod.isActive, true),
				isNull(workPeriod.clockOutId),
				isNull(workPeriod.endTime),
				isNull(workPeriod.deletedAt),
			),
		);
	return rows.map((row) => ({
		...row,
		state: row.breakSince ? "on_break" : "clocked_in",
		breakSince: row.breakSince ?? null,
		breakZone: row.breakSince ? row.breakZone : null,
	}));
}

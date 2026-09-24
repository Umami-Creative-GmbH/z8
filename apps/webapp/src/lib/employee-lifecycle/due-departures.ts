import { and, asc, eq, lte } from "drizzle-orm";
import type { db as rootDatabase } from "@/db";
import { employeeDeparture } from "@/db/schema/employee-lifecycle";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import type { DepartureIdentity } from "./types";

const DUE_BATCH_LIMIT = 100;

/**
 * Global discovery of due departures for infrastructure only; every
 * execution reloads and re-validates its own organization-scoped state.
 * Ordered by cutoff then ID so owner outcomes are deterministic.
 */
export async function findDueDepartures(
	database: Pick<typeof rootDatabase, "select">,
	now: Instant,
): Promise<DepartureIdentity[]> {
	return database
		.select({
			organizationId: employeeDeparture.organizationId,
			employeeId: employeeDeparture.employeeId,
			employmentPeriodId: employeeDeparture.employmentPeriodId,
			departureId: employeeDeparture.id,
			revision: employeeDeparture.revision,
		})
		.from(employeeDeparture)
		.where(
			and(
				eq(employeeDeparture.status, "pending"),
				lte(employeeDeparture.cutoffAt, dateFromInstant(now)),
			),
		)
		.orderBy(asc(employeeDeparture.cutoffAt), asc(employeeDeparture.id))
		.limit(DUE_BATCH_LIMIT);
}

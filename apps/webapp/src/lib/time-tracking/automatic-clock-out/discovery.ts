import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { employee, organizationTimeTrackingSettings, workPeriod } from "@/db/schema";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import type { AutoClockOutCandidate } from "./types";

/** Read-only hints; settings and live state are decided again under the work transaction. */
export async function listDueAutoClockOutCandidates(
	input: { now: Instant; after: AutoClockOutCandidate | null; limit: number },
	database: typeof db,
): Promise<AutoClockOutCandidate[]> {
	if (!Number.isSafeInteger(input.limit) || input.limit < 1) {
		throw new RangeError("Candidate page size must be a positive integer");
	}
	const { after } = input;
	return database
		.select({
			organizationId: workPeriod.organizationId,
			employeeId: workPeriod.employeeId,
			workPeriodId: workPeriod.id,
		})
		.from(workPeriod)
		.innerJoin(organization, eq(organization.id, workPeriod.organizationId))
		.innerJoin(
			employee,
			and(
				eq(employee.id, workPeriod.employeeId),
				eq(employee.organizationId, workPeriod.organizationId),
			),
		)
		.leftJoin(
			organizationTimeTrackingSettings,
			eq(organizationTimeTrackingSettings.organizationId, workPeriod.organizationId),
		)
		.where(
			and(
				isNull(organization.deletedAt),
				isNull(workPeriod.deletedAt),
				eq(workPeriod.isActive, true),
				isNull(workPeriod.endTime),
				isNull(workPeriod.clockOutId),
				sql`coalesce(${organizationTimeTrackingSettings.autoClockOutEnabled}, true)`,
				// start_time is a timestamp without zone whose stored value is canonical UTC.
				sql`(${workPeriod.startTime} AT TIME ZONE 'UTC') + coalesce(${organizationTimeTrackingSettings.maxUninterruptedMinutes}, 720) * interval '1 minute' <= ${dateFromInstant(input.now).toISOString()}::timestamptz`,
				after
					? sql`(${workPeriod.organizationId}, ${workPeriod.employeeId}, ${workPeriod.id}) > (${after.organizationId}, ${after.employeeId}::uuid, ${after.workPeriodId}::uuid)`
					: undefined,
			),
		)
		.orderBy(asc(workPeriod.organizationId), asc(workPeriod.employeeId), asc(workPeriod.id))
		.limit(input.limit);
}

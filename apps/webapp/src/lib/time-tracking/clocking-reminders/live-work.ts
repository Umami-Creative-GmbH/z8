import { and, eq, isNull, type SQL } from "drizzle-orm";
import { workPeriod } from "@/db/schema";

/**
 * A work period that is live for the clocking reminders: active, not deleted, with no end and no
 * clock-out. Shared so the reminders job and occasion retention never disagree about it.
 */
export function isLiveWorkPeriod(): SQL {
	return and(
		eq(workPeriod.isActive, true),
		isNull(workPeriod.deletedAt),
		isNull(workPeriod.endTime),
		isNull(workPeriod.clockOutId),
	) as SQL;
}

import { and, eq, isNull, type SQL } from "drizzle-orm";
import { workPeriod } from "@/db/schema";

/**
 * The work periods that reports count: completed work only.
 *
 * - Live work (a running period) never counts, so it adds neither hours nor
 *   a period to any count or list.
 * - Work deleted by an approved deletion correction keeps its times in the row
 *   (`deletedAt` is set), but it no longer exists as work (#794).
 *
 * Combine with the reader's own organization, scope and range conditions.
 */
export function completedWorkPeriodCondition(): SQL {
	return and(eq(workPeriod.isActive, false), isNull(workPeriod.deletedAt)) as SQL;
}

import { and, eq, type SQL } from "drizzle-orm";
import { absenceCategory } from "@/db/schema";

/**
 * `releasesRequiredTime` (./category-rules) as a condition on a query joined to
 * `absence_category`: every reader of required time releases it for the same absences.
 */
export function absenceCategoryReleasesRequiredTime(): SQL {
	return and(
		eq(absenceCategory.requiresWorkTime, false),
		eq(absenceCategory.drawsOnWorkBalance, false),
	) as SQL;
}

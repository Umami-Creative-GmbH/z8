import "server-only";
import { revalidatePath, revalidateTag } from "next/cache";
import { revalidateWorkDataCache } from "@/lib/analytics/cache";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { createLogger } from "@/lib/logger";
import { processWorkBalanceRebuildIntents } from "@/lib/work-balance/rebuild-intents";
import { refreshEmployeeWorkBalanceFromPeriods } from "@/lib/work-balance/service";
import { revalidateWorkBalancePaths } from "@/app/[locale]/(app)/settings/employees/work-balance-paths";
import type { TrackingDateImpact } from "./tracking-date-review-types";
const logger = createLogger("TrackingDateActions");
export async function refreshTrackingDateResults(
	organizationId: string,
	impact: TrackingDateImpact,
): Promise<boolean> {
	let refreshPending = false;
	try {
		const rebuilt = await processWorkBalanceRebuildIntents({
			organizationId: organizationId,
		});
		refreshPending = rebuilt.failures.length > 0;
		if (!refreshPending) {
			const refreshed = await Promise.allSettled(
				impact.employees.map((row) =>
					refreshEmployeeWorkBalanceFromPeriods({
						organizationId: organizationId,
						employeeId: row.employeeId,
					}),
				),
			);
			refreshPending = refreshed.some((result) => result.status === "rejected");
		}
	} catch (error) {
		refreshPending = true;
		logger.error(
			{ error, organizationId: organizationId },
			"Tracking date saved; durable balance refresh will retry",
		);
	}
	try {
		revalidateWorkBalancePaths(impact.employees.map((row) => row.employeeId));
		for (const path of [
			"/settings/organizations",
			"/calendar",
			"/dashboard",
			"/reports",
			"/payroll/work-balances",
		])
			revalidatePath(path);
		revalidateTag(CACHE_TAGS.EMPLOYEES(organizationId), { expire: 0 });
		revalidateWorkDataCache(organizationId);
	} catch (error) {
		logger.error(
			{ error, organizationId: organizationId },
			"Tracking date saved; cache refresh failed",
		);
	}

	return refreshPending;
}

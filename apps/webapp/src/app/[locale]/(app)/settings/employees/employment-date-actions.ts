"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { revalidateWorkDataCache } from "@/lib/analytics/cache";
import { requireOrganizationAdmin } from "@/lib/auth/current-organization-actor";
import { CACHE_TAGS } from "@/lib/cache/tags";
import type {EmploymentDateCorrectionImpact} from "@/lib/employee-lifecycle/employment-date-correction-types";
import { systemClock } from "@/lib/datetime/temporal-core";
import { runRefusalAction } from "@/lib/effect/refusal-action";
import { createLogger } from "@/lib/logger";
import {
	commitEmploymentDateCorrection,
	previewEmploymentDateCorrection,
} from "@/lib/employee-lifecycle/employment-date-correction";
import {
	type TrackingDateActionResult,
	
	TrackingDateRefusal,
} from "@/lib/time-tracking/tracking-date-review-types";
import { processWorkBalanceRebuildIntents } from "@/lib/work-balance/rebuild-intents";
import { refreshEmployeeWorkBalanceFromPeriods } from "@/lib/work-balance/service";
import { revalidateWorkBalancePaths } from "./work-balance-paths";

const logger = createLogger("TrackingDateActions");
const notPermitted = () =>
	new TrackingDateRefusal("not_permitted", "Only an organization admin can correct employment dates.");
export async function previewEmploymentDateCorrectionAction(input: {
	employeeId:string;
 employmentStartDate: string;
}): Promise<TrackingDateActionResult<EmploymentDateCorrectionImpact>> {
	return runRefusalAction("employmentDates.preview", TrackingDateRefusal, async (database) => {
		const actor = await requireOrganizationAdmin(notPermitted);
		return previewEmploymentDateCorrection(database, {
			...input,
			organizationId: actor.organizationId,
			actorUserId: actor.userId,
			now: systemClock.nowInstant(),
		});
	});
}
export async function commitEmploymentDateCorrectionAction(input: {
	employeeId:string;
 employmentStartDate: string;
	fingerprint: string;
	reason: string;
}): Promise<TrackingDateActionResult<{ status: "committed"; refreshPending: boolean }>> {
	return runRefusalAction("employmentDates.commit", TrackingDateRefusal, async (database) => {
		const actor = await requireOrganizationAdmin(notPermitted);
		const impact = await commitEmploymentDateCorrection(database, {
			...input,
			organizationId: actor.organizationId,
			actorUserId: actor.userId,
			now: systemClock.nowInstant(),
		});
		let refreshPending = false;
		try {
			const rebuilt = await processWorkBalanceRebuildIntents({
				organizationId: actor.organizationId,
			});
			refreshPending = rebuilt.failures.length > 0;
			if (!refreshPending) {
				const refreshed = await Promise.allSettled(
					impact.employees.map((row) =>
						refreshEmployeeWorkBalanceFromPeriods({
							organizationId: actor.organizationId,
							employeeId: row.employeeId,
						}),
					),
				);
				refreshPending = refreshed.some((result) => result.status === "rejected");
			}
		} catch (error) {
			refreshPending = true;
			logger.error(
				{ error, organizationId: actor.organizationId },
				"Employment date saved; durable balance refresh will retry",
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
			revalidateTag(CACHE_TAGS.EMPLOYEES(actor.organizationId), { expire: 0 });
			revalidateWorkDataCache(actor.organizationId);
		} catch (error) {
			logger.error(
				{ error, organizationId: actor.organizationId },
				"Employment date saved; cache refresh failed",
			);
		}

		return { status: "committed", refreshPending };
	});
}

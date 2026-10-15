"use server";

import { requireOrganizationAdmin } from "@/lib/auth/current-organization-actor";
import { systemClock } from "@/lib/datetime/temporal-core";
import { runRefusalAction } from "@/lib/effect/refusal-action";
import {
	commitEmploymentDateCorrection,
	previewEmploymentDateCorrection,
} from "@/lib/employee-lifecycle/employment-date-correction";
import type { EmploymentDateCorrectionImpact } from "@/lib/employee-lifecycle/employment-date-correction-types";
import { refreshEmploymentDateResults } from "@/lib/employee-lifecycle/employment-date-refresh";
import {
	type TrackingDateActionResult,
	TrackingDateRefusal,
} from "@/lib/time-tracking/tracking-date-review-types";

const notPermitted = () =>
	new TrackingDateRefusal(
		"not_permitted",
		"Only an organization admin can correct employment dates.",
	);
export async function previewEmploymentDateCorrectionAction(input: {
	employeeId: string;
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
	employeeId: string;
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
		const refreshPending = await refreshEmploymentDateResults(actor.organizationId, impact);
		return { status: "committed", refreshPending };
	});
}

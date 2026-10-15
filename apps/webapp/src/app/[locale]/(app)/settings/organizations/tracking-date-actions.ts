"use server";

import { requireOrganizationAdmin } from "@/lib/auth/current-organization-actor";
import { refreshTrackingDateResults } from "@/lib/time-tracking/tracking-date-refresh";
import { systemClock } from "@/lib/datetime/temporal-core";
import { runRefusalAction } from "@/lib/effect/refusal-action";
import {
	commitOrganizationTrackingDate,
	previewOrganizationTrackingDate,
} from "@/lib/time-tracking/tracking-date-review";
import {
	type TrackingDateActionResult,
	type TrackingDateImpact,
	TrackingDateRefusal,
} from "@/lib/time-tracking/tracking-date-review-types";

const notPermitted = () =>
	new TrackingDateRefusal("not_permitted", "Only an organization admin can change tracking dates.");
export async function previewOrganizationTrackingDateAction(input: {
	trackingStartDate: string;
}): Promise<TrackingDateActionResult<TrackingDateImpact>> {
	return runRefusalAction("trackingDates.preview", TrackingDateRefusal, async (database) => {
		const actor = await requireOrganizationAdmin(notPermitted);
		return previewOrganizationTrackingDate(database, {
			...input,
			organizationId: actor.organizationId,
			actorUserId: actor.userId,
			now: systemClock.nowInstant(),
		});
	});
}
export async function commitOrganizationTrackingDateAction(input: {
	trackingStartDate: string;
	fingerprint: string;
	reason: string;
}): Promise<TrackingDateActionResult<{ status: "committed"; refreshPending: boolean }>> {
	return runRefusalAction("trackingDates.commit", TrackingDateRefusal, async (database) => {
		const actor = await requireOrganizationAdmin(notPermitted);
		const impact = await commitOrganizationTrackingDate(database, {
			...input,
			organizationId: actor.organizationId,
			actorUserId: actor.userId,
			now: systemClock.nowInstant(),
		});
		const refreshPending = await refreshTrackingDateResults(actor.organizationId, impact);
		return { status: "committed", refreshPending };
	});
}

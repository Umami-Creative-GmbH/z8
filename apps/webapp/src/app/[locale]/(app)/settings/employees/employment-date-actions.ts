"use server";

import { z } from "zod";
import { systemClock } from "@/lib/datetime/temporal-core";
import {
	commitEmploymentDateCorrection,
	previewEmploymentDateCorrection,
} from "@/lib/employee-lifecycle/employment-date-correction";
import { refreshEmploymentDateResults } from "@/lib/employee-lifecycle/employment-date-refresh";
import { refusalStep } from "@/lib/organization-action/action-refusal";
import { organizationAction } from "@/lib/organization-action/organization-action";
import { TrackingDateRefusal } from "@/lib/time-tracking/tracking-date-review-types";

const correctionSchema = z.strictObject({
	employeeId: z.uuid("Invalid employee"),
	employmentStartDate: z.string(),
});

export const previewEmploymentDateCorrectionAction = organizationAction(
	{ name: "employmentDates.preview", requires: "orgAdmin", schema: correctionSchema },
	({ actor, organizationId, input }) =>
		refusalStep("employmentDates.preview", TrackingDateRefusal, (database) =>
			previewEmploymentDateCorrection(database, {
				...input,
				organizationId,
				actorUserId: actor.userId,
				now: systemClock.nowInstant(),
			}),
		),
);

export const commitEmploymentDateCorrectionAction = organizationAction(
	{
		name: "employmentDates.commit",
		requires: "orgAdmin",
		schema: correctionSchema.extend({ fingerprint: z.string(), reason: z.string() }),
	},
	({ actor, organizationId, input }) =>
		refusalStep("employmentDates.commit", TrackingDateRefusal, async (database) => {
			const impact = await commitEmploymentDateCorrection(database, {
				...input,
				organizationId,
				actorUserId: actor.userId,
				now: systemClock.nowInstant(),
			});
			const refreshPending = await refreshEmploymentDateResults(organizationId, impact);
			return { status: "committed" as const, refreshPending };
		}),
);

"use server";

import { z } from "zod";
import { systemClock } from "@/lib/datetime/temporal-core";
import {
	commitEmploymentDateCorrection,
	previewEmploymentDateCorrection,
} from "@/lib/employee-lifecycle/employment-date-correction";
import { refreshEmploymentDateResults } from "@/lib/employee-lifecycle/employment-date-refresh";
import { organizationAction } from "@/lib/organization-action/organization-action";
import { storeStep } from "@/lib/organization-action/store-step";
import { TrackingDateRefusal } from "@/lib/time-tracking/tracking-date-review-types";

const correctionSchema = z.strictObject({
	employeeId: z.uuid("Invalid employee"),
	employmentStartDate: z.string(),
});

export const previewEmploymentDateCorrectionAction = organizationAction(
	{ name: "employmentDates.preview", requires: "orgAdmin", schema: correctionSchema },
	({ actor, organizationId, input }) =>
		storeStep(
			"employmentDates.preview",
			(database) =>
				previewEmploymentDateCorrection(database, {
					...input,
					organizationId,
					actorUserId: actor.userId,
					now: systemClock.nowInstant(),
				}),
			{ refusal: TrackingDateRefusal },
		),
);

export const commitEmploymentDateCorrectionAction = organizationAction(
	{
		name: "employmentDates.commit",
		requires: "orgAdmin",
		schema: correctionSchema.extend({ fingerprint: z.string(), reason: z.string() }),
	},
	({ actor, organizationId, input }) =>
		storeStep(
			"employmentDates.commit",
			async (database) => {
				const impact = await commitEmploymentDateCorrection(database, {
					...input,
					organizationId,
					actorUserId: actor.userId,
					now: systemClock.nowInstant(),
				});
				const refreshPending = await refreshEmploymentDateResults(organizationId, impact);
				return { status: "committed" as const, refreshPending };
			},
			{ refusal: TrackingDateRefusal },
		),
);

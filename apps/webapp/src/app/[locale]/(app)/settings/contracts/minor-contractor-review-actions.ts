"use server";

import { z } from "zod";
import { systemClock } from "@/lib/datetime/temporal-core";
import { organizationAction } from "@/lib/organization-action/organization-action";
import { storeStep } from "@/lib/organization-action/store-step";
import {
	acknowledgeMinorContractorReview,
	listMinorContractorReviews,
	type MinorContractorReview,
} from "@/lib/statutory/youth/minor-contractor-review";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";

// Minor contractors for youth-protection review in Settings → Contracts → Reviews & Conflicts
// (#2022). Org admins only: the list carries the input fingerprints the acknowledgement must match.

const acknowledgeSchema = z.strictObject({
	employeeId: z.uuid("Invalid selection."),
	subjectKey: z.string().min(1).max(200),
	expectedFingerprint: z.string().min(1).max(200),
	reason: z.string().max(1000),
	legalNote: z.string().max(500).nullable().optional(),
});

export type AcknowledgeMinorContractorReviewInput = z.input<typeof acknowledgeSchema>;

export const listMinorContractorReviewsAction = organizationAction(
	{
		name: "statutory.minorContractorReviews.list",
		requires: "orgAdmin",
		// "Show resolved" in Reviews & Conflicts also lists documented engagements.
		schema: z.strictObject({ includeAcknowledged: z.boolean().optional() }),
	},
	({ organizationId, input }) =>
		storeStep(
			"statutory.minorContractorReviews.list",
			async (db): Promise<MinorContractorReview[]> =>
				listMinorContractorReviews(db, {
					organizationId,
					timezone: await loadOrganizationTimezone(db, organizationId),
					now: systemClock.nowInstant(),
					includeAcknowledged: input.includeAcknowledged ?? false,
				}),
		),
);

export const acknowledgeMinorContractorReviewAction = organizationAction(
	{
		name: "statutory.minorContractorReviews.acknowledge",
		requires: "orgAdmin",
		schema: acknowledgeSchema,
	},
	({ actor, organizationId, input }) =>
		storeStep("statutory.minorContractorReviews.acknowledge", async (db) => {
			const record = await acknowledgeMinorContractorReview(db, {
				...input,
				organizationId,
				actorUserId: actor.userId,
				timezone: await loadOrganizationTimezone(db, organizationId),
				now: systemClock.nowInstant(),
			});
			return { id: record.id, acknowledgedAt: record.acknowledgedAt };
		}),
);

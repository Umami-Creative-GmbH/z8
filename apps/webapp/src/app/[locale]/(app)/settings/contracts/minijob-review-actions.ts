"use server";

import { z } from "zod";
import { systemClock } from "@/lib/datetime/temporal-core";
import { organizationAction } from "@/lib/organization-action/organization-action";
import { storeStep } from "@/lib/organization-action/store-step";
import { acknowledgeMinijobExceedance } from "@/lib/statutory/minijob/acknowledge-minijob-exceedance";
import { loadMinijobExceedanceReviews } from "@/lib/statutory/minijob/minijob-reviews";

// Minijob exceedance months in Settings → Contracts → Reviews & Conflicts (#1989). Org admins
// only: the queue shows EUR earnings against the cap.

export const listMinijobExceedanceReviewsAction = organizationAction(
	{
		name: "contracts.listMinijobExceedanceReviews",
		requires: "orgAdmin",
		schema: z.strictObject({ includeAcknowledged: z.boolean() }),
	},
	({ organizationId, input }) =>
		storeStep("contracts.listMinijobExceedanceReviews", (db) =>
			loadMinijobExceedanceReviews(db, {
				organizationId,
				now: systemClock.nowInstant(),
				includeAcknowledged: input.includeAcknowledged,
			}),
		),
);

export const acknowledgeMinijobExceedanceAction = organizationAction(
	{
		name: "contracts.acknowledgeMinijobExceedance",
		requires: "orgAdmin",
		schema: z.strictObject({
			employeeId: z.uuid(),
			month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
			reason: z.string().trim().min(1, "Explain why the exceedance was unforeseeable").max(2000),
			legalNote: z.string().trim().max(500).nullable(),
			/** The month's fingerprint as listed: a precondition, never what is recorded. */
			expectedFingerprint: z.string().min(1).max(200),
			/** The month's total (EUR cents) as listed: a precondition too, never what is recorded. */
			expectedTotalCents: z.number().int().nonnegative().max(100_000_000),
		}),
	},
	({ actor, organizationId, input }) =>
		storeStep("contracts.acknowledgeMinijobExceedance", async (db) => {
			// The month is evaluated again server-side and recorded with the server's fingerprint,
			// only when it and the total still are the ones the admin was shown.
			const record = await acknowledgeMinijobExceedance(db, {
				organizationId,
				actorUserId: actor.userId,
				employeeId: input.employeeId,
				month: input.month,
				reason: input.reason,
				legalNote: input.legalNote,
				expectedFingerprint: input.expectedFingerprint,
				expectedTotalCents: input.expectedTotalCents,
				now: systemClock.nowInstant(),
			});
			return { id: record.id, acknowledgedAt: record.acknowledgedAt };
		}),
);

"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getEffectiveApprovalTriagePolicy } from "@/lib/approvals/triage-policy";
import { saveApprovalTriageSettings } from "@/lib/approvals/triage-settings";
import { DatabaseError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";

const BOTH_THRESHOLDS = "Provide both approval triage thresholds.";
const STALE_AGE_MESSAGE = "Stale age must be a whole number from 1 to 720 hours.";
const SMALL_CORRECTION_MESSAGE = "Small correction must be a whole number from 0 to 60 minutes.";

const triageThresholdsSchema = z.object(
	{
		staleAfterHours: z
			.number({
				error: (issue) => (issue.input === undefined ? BOTH_THRESHOLDS : STALE_AGE_MESSAGE),
			})
			.int(STALE_AGE_MESSAGE)
			.min(1, STALE_AGE_MESSAGE)
			.max(720, STALE_AGE_MESSAGE),
		smallCorrectionMinutes: z
			.number({
				error: (issue) => (issue.input === undefined ? BOTH_THRESHOLDS : SMALL_CORRECTION_MESSAGE),
			})
			.int(SMALL_CORRECTION_MESSAGE)
			.min(0, SMALL_CORRECTION_MESSAGE)
			.max(60, SMALL_CORRECTION_MESSAGE),
	},
	{ error: () => BOTH_THRESHOLDS },
);
/** Any value from the client; the thresholds are checked on the server. */
const triageSettingsSchema = z.unknown().pipe(triageThresholdsSchema);

/** A failed read or save, with a message safe to show users. */
function failedWith(message: string) {
	return (cause: unknown) =>
		new DatabaseError({ message, operation: "approvalTriageSettings", cause });
}

export const getApprovalTriageSettingsAction = organizationAction(
	{ name: "approvalTriageSettings.get", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.tryPromise({
			try: () => getEffectiveApprovalTriagePolicy({ organizationId }),
			catch: failedWith("Unable to load approval triage settings. Please try again."),
		}),
);

export const saveApprovalTriageSettingsAction = organizationAction(
	{ name: "approvalTriageSettings.save", requires: "orgAdmin", schema: triageSettingsSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const data = yield* Effect.tryPromise({
				try: () =>
					saveApprovalTriageSettings(dbService.db, {
						organizationId,
						actorUserId: actor.userId,
						staleAfterHours: input.staleAfterHours,
						smallCorrectionMinutes: input.smallCorrectionMinutes,
					}),
				catch: failedWith("Unable to save approval triage settings. Please try again."),
			});
			revalidatePath("/[locale]/(app)/settings/approval-policies", "page");
			revalidatePath("/[locale]/(app)/approvals", "page");
			revalidatePath("/[locale]/(app)/approvals/inbox", "page");
			return data;
		}),
);

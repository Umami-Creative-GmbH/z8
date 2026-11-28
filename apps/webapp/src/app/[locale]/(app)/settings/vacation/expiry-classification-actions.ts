"use server";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
	LeaveExpiryClassificationRefused,
	recordLeaveExpiryClassification,
} from "@/lib/absences/earning-year-leave-store";
import { storeStep } from "@/lib/organization-action/store-step";
import { organizationAction } from "@/lib/organization-action/organization-action";

const classificationSchema = z.object({
	policyId: z.string().uuid(),
	expiryRules: z.enum(["german", "policy_terms"]),
	extraDaysSeparateTerms: z.boolean(),
	extraDaysTermsBasis: z.string().max(2000).nullable(),
});

/**
 * HR designates whether German leave-expiry rules apply to the leave earned under a vacation policy
 * of the active organization (#2080). The designation is final, like policy edits it needs an org
 * admin, and it reaches every earning year of the policy at once.
 */
export const classifyVacationPolicyExpiryRules = organizationAction(
	{ name: "vacation.classifyPolicyExpiryRules", requires: "orgAdmin", schema: classificationSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const recorded = yield* storeStep(
				"vacation.classifyPolicyExpiryRules",
				(db) =>
					recordLeaveExpiryClassification(db, {
						organizationId,
						...input,
						classifiedBy: actor.userId,
						classifiedAt: new Date(),
					}),
				{ refusal: LeaveExpiryClassificationRefused },
			);
			revalidatePath("/[locale]/(app)/settings/vacation", "layout");
			revalidatePath("/[locale]/(app)/absences", "page");
			revalidatePath("/[locale]/(app)/dashboard", "page");
			return recorded;
		}),
);

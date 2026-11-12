"use server";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
	historicalVacationInputSchema,
	historicalVacationRefusalOf,
	reviewPreviouslyTakenVacation,
} from "@/lib/absences/historical-vacation";
import { ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { organizationAction } from "@/lib/organization-action/organization-action";

/** The review input; the organization is the session's active one. */
const reviewInputSchema = historicalVacationInputSchema.omit({ organizationId: true });

/** One message for any malformed review, as the form shows it. */
function reviewSchema(commit: boolean) {
	return z.unknown().transform((value, context) => {
		const parsed = reviewInputSchema.safeParse(value);
		if (!parsed.success) {
			context.addIssue({
				code: "custom",
				message: "Choose an employee, year, nonnegative half-day amount and a review reason.",
			});
			return z.NEVER;
		}
		const fingerprint =
			value && typeof value === "object" && "fingerprint" in value ? value.fingerprint : undefined;
		if (commit && (typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint))) {
			context.addIssue({
				code: "custom",
				message: "Review the historical usage before saving.",
				path: ["fingerprint"],
			});
			return z.NEVER;
		}
		return { ...parsed.data, fingerprint: typeof fingerprint === "string" ? fingerprint : undefined };
	});
}

function review(
	userId: string,
	organizationId: string,
	input: z.output<ReturnType<typeof reviewSchema>>,
	commit: boolean,
) {
	return Effect.gen(function* () {
		const { fingerprint, ...reviewInput } = input;
		const database = yield* DatabaseService;
		const reviewed = yield* database
			.query("vacation.reviewHistoricalUsage", () =>
				database.db.transaction((tx) =>
					reviewPreviouslyTakenVacation(
						tx,
						{ ...reviewInput, organizationId },
						userId,
						commit ? fingerprint : undefined,
					),
				),
			)
			.pipe(
				Effect.mapError((error) => {
					const refusal = historicalVacationRefusalOf(error);
					return refusal
						? new ValidationError({ message: refusal.message, refusal: refusal.refusal })
						: error;
				}),
			);
		if (commit) {
			revalidatePath("/[locale]/(app)/absences", "page");
			revalidatePath("/[locale]/(app)/settings/vacation", "layout");
			revalidatePath("/[locale]/(app)/team/absences", "page");
			revalidatePath("/[locale]/(app)/dashboard", "page");
		}
		return reviewed;
	});
}

/** Reviews vacation an employee took before Z8, in the active organization. */
export const previewPreviouslyTakenVacation = organizationAction(
	{ name: "vacation.previewHistoricalUsage", requires: "orgAdmin", schema: reviewSchema(false) },
	({ actor, organizationId, input }) => review(actor.userId, organizationId, input, false),
);

/** Records the reviewed vacation an employee took before Z8. */
export const commitPreviouslyTakenVacation = organizationAction(
	{ name: "vacation.commitHistoricalUsage", requires: "orgAdmin", schema: reviewSchema(true) },
	({ actor, organizationId, input }) => review(actor.userId, organizationId, input, true),
);
"use server";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import {
	historicalVacationInputSchema,
	historicalVacationRefusalOf,
	reviewPreviouslyTakenVacation,
} from "@/lib/absences/historical-vacation";
import { requireActiveOrganizationActionActor } from "@/lib/auth/organization-action-authorization";
import { ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe } from "@/lib/effect/result";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";

function runReview(input: unknown, commit: boolean) {
	return runServerActionSafe(
		Effect.gen(function* () {
			const parsed = historicalVacationInputSchema.safeParse(input);
			if (!parsed.success)
				return yield* Effect.fail(
					new ValidationError({
						message: "Choose an employee, year, nonnegative half-day amount and a review reason.",
					}),
				);
			const fingerprint =
				input && typeof input === "object" && "fingerprint" in input
					? input.fingerprint
					: undefined;
			if (commit && (typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint)))
				return yield* Effect.fail(
					new ValidationError({ message: "Review the historical usage before saving." }),
				);
			const auth = yield* AuthService;
			const session = yield* auth.getSession(parsed.data.organizationId);
			if (session.session.activeOrganizationId !== parsed.data.organizationId)
				return yield* Effect.fail(
					new ValidationError({
						message: "Select this organization before reviewing historical usage.",
					}),
				);
			yield* requireActiveOrganizationActionActor({
				userId: session.user.id,
				organizationId: parsed.data.organizationId,
				requiredRole: "admin",
				message: "Only active organization admins can record previously taken vacation.",
				resource: "vacation",
				action: "manageHistoricalUsage",
			});
			const database = yield* DatabaseService;
			const reviewed = yield* database
				.query("vacation.reviewHistoricalUsage", () =>
					database.db.transaction((tx) =>
						reviewPreviouslyTakenVacation(
							tx,
							parsed.data,
							session.user.id,
							commit ? (fingerprint as string) : undefined,
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
		}),
	);
}
export async function previewPreviouslyTakenVacation(input: unknown) {
	return runReview(input, false);
}
export async function commitPreviouslyTakenVacation(input: unknown) {
	return runReview(input, true);
}

"use server";

import { Effect } from "effect";
import { z } from "zod";
import { getRequestSession } from "@/lib/auth/request-session";
import { systemClock } from "@/lib/datetime/temporal-core";
import { AuthenticationError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	type PeriodSubmissionRefusal,
	submitPeriodSubmission,
} from "@/lib/time-tracking/period-submissions/submission-service";

const submitSchema = z.object({
	periodStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type SubmitPeriodResult =
	| { kind: "submitted" }
	| { kind: "refused"; reason: PeriodSubmissionRefusal };

/**
 * Submits one of the signed-in employee's own periods in the active organization (#1059).
 * Nobody submits on someone else's behalf. A refusal comes back as data so the period view can
 * explain it in the employee's language.
 */
export async function submitPeriod(input: {
	periodStartDate: string;
}): Promise<ServerActionResult<SubmitPeriodResult>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const parsed = submitSchema.safeParse(input);
			if (!parsed.success) {
				return yield* Effect.fail(new ValidationError({ message: "Choose a period to submit" }));
			}
			const session = yield* Effect.tryPromise({
				try: getRequestSession,
				catch: () => new AuthenticationError({ message: "Authentication required" }),
			});
			const organizationId = session?.session.activeOrganizationId;
			if (!session || !organizationId) {
				return yield* Effect.fail(new AuthenticationError({ message: "Authentication required" }));
			}
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query("periodSubmissions.submit", () =>
				submitPeriodSubmission(
					{ organizationId, userId: session.user.id, periodStartDate: parsed.data.periodStartDate },
					{ database: dbService.db, clock: systemClock },
				),
			);
			return result.kind === "submitted"
				? ({ kind: "submitted" } as const)
				: ({ kind: "refused", reason: result.reason } as const);
		}),
	);
}

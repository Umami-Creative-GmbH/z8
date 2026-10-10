"use server";

import { Effect } from "effect";
import { z } from "zod";
import { getRequestSession } from "@/lib/auth/request-session";
import { systemClock } from "@/lib/datetime/temporal-core";
import { AuthenticationError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { DatabaseService } from "@/lib/effect/services/database.service";
import type { PeriodSubmissionBlocker } from "@/lib/time-tracking/period-submissions/submission-blockers";
import {
	type PeriodSubmissionRefusal,
	submitPeriodSubmission,
} from "@/lib/time-tracking/period-submissions/submission-service";
import { withdrawOwnPeriodSubmission } from "@/lib/time-tracking/period-submissions/submission-withdrawal";

const periodSchema = z.object({
	periodStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type SubmitPeriodResult =
	| { kind: "submitted" }
	| { kind: "refused"; reason: "period_open"; blockers: PeriodSubmissionBlocker[] }
	| { kind: "refused"; reason: Exclude<PeriodSubmissionRefusal, "period_open"> };

export type WithdrawPeriodResult =
	| { kind: "withdrawn" }
	| { kind: "refused"; reason: "not_employee" | "not_pending" };

const signedInOrganization = Effect.gen(function* () {
	const session = yield* Effect.tryPromise({
		try: getRequestSession,
		catch: () => new AuthenticationError({ message: "Authentication required" }),
	});
	const organizationId = session?.session.activeOrganizationId;
	if (!session || !organizationId) {
		return yield* Effect.fail(new AuthenticationError({ message: "Authentication required" }));
	}
	return { organizationId, userId: session.user.id };
});

/**
 * Submits one of the signed-in employee's own periods in the active organization (#1059).
 * Nobody submits on someone else's behalf. A refusal comes back as data so the period view can
 * explain it in the employee's language, with what keeps an open period from being submitted
 * (#1060).
 */
export async function submitPeriod(input: {
	periodStartDate: string;
}): Promise<ServerActionResult<SubmitPeriodResult>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const parsed = periodSchema.safeParse(input);
			if (!parsed.success) {
				return yield* Effect.fail(new ValidationError({ message: "Choose a period to submit" }));
			}
			const { organizationId, userId } = yield* signedInOrganization;
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query("periodSubmissions.submit", () =>
				submitPeriodSubmission(
					{ organizationId, userId, periodStartDate: parsed.data.periodStartDate },
					{ database: dbService.db, clock: systemClock },
				),
			);
			if (result.kind === "submitted") return { kind: "submitted" } as const;
			return result.reason === "period_open"
				? ({ kind: "refused", reason: result.reason, blockers: result.blockers } as const)
				: ({ kind: "refused", reason: result.reason } as const);
		}),
	);
}

/**
 * Withdraws the signed-in employee's own pending submission of one period (#1060). The period
 * awaits submission again; an approved or rejected submission is refused as data.
 */
export async function withdrawPeriod(input: {
	periodStartDate: string;
}): Promise<ServerActionResult<WithdrawPeriodResult>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const parsed = periodSchema.safeParse(input);
			if (!parsed.success) {
				return yield* Effect.fail(new ValidationError({ message: "Choose a period to withdraw" }));
			}
			const { organizationId, userId } = yield* signedInOrganization;
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query("periodSubmissions.withdraw", () =>
				withdrawOwnPeriodSubmission(
					{ organizationId, userId, periodStartDate: parsed.data.periodStartDate },
					{ database: dbService.db, clock: systemClock },
				),
			);
			return result.kind === "withdrawn"
				? ({ kind: "withdrawn" } as const)
				: ({ kind: "refused", reason: result.reason } as const);
		}),
	);
}

"use server";

import { Effect } from "effect";
import { z } from "zod";
import { requireActiveOrganizationActionActor } from "@/lib/auth/organization-action-authorization";
import { getRequestSession } from "@/lib/auth/request-session";
import { systemClock } from "@/lib/datetime/temporal-core";
import { AuthenticationError, AuthorizationError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	SUBMISSION_WEEKDAYS,
	type SubmissionCadence,
} from "@/lib/time-tracking/period-submissions/cadence";
import { savePeriodSubmissionSettings } from "@/lib/time-tracking/period-submissions/settings";
import {
	MAX_SECOND_REMINDER_DELAY_DAYS,
	MIN_SECOND_REMINDER_DELAY_DAYS,
	type PeriodSubmissionSettings,
} from "@/lib/time-tracking/period-submissions/settings-policy";

const cadenceSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("off") }),
	z.object({ kind: z.literal("weekly"), weekStartDay: z.enum(SUBMISSION_WEEKDAYS) }),
	z.object({ kind: z.literal("monthly") }),
]);
const settingsSchema = z.object({
	organizationId: z.string().min(1),
	cadence: cadenceSchema,
	secondReminderDelayDays: z
		.number()
		.int()
		.min(MIN_SECOND_REMINDER_DELAY_DAYS)
		.max(MAX_SECOND_REMINDER_DELAY_DAYS),
});

export interface UpdatePeriodSubmissionSettingsInput {
	organizationId: string;
	cadence: SubmissionCadence;
	secondReminderDelayDays: number;
}

/** Saves the submission cadence and reminder delay. Only approved owners and admins may. */
export async function updatePeriodSubmissionSettings(
	input: UpdatePeriodSubmissionSettingsInput,
): Promise<ServerActionResult<PeriodSubmissionSettings>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const parsed = settingsSchema.safeParse(input);
			if (!parsed.success) {
				return yield* Effect.fail(
					new ValidationError({ message: "Enter valid period submission settings" }),
				);
			}
			const session = yield* Effect.tryPromise({
				try: getRequestSession,
				catch: () => new AuthenticationError({ message: "Authentication required" }),
			});
			if (!session) {
				return yield* Effect.fail(new AuthenticationError({ message: "Authentication required" }));
			}
			if (session.session.activeOrganizationId !== parsed.data.organizationId) {
				return yield* Effect.fail(
					new AuthorizationError({
						message: "Select the organization before changing its settings",
					}),
				);
			}
			yield* requireActiveOrganizationActionActor({
				userId: session.user.id,
				organizationId: parsed.data.organizationId,
				requiredRole: "admin",
				message:
					"Only approved organization admins and owners can change period submission settings",
				resource: "organization",
				action: "update",
			});
			const dbService = yield* DatabaseService;
			return yield* dbService.query("periodSubmissions.saveSettings", () =>
				savePeriodSubmissionSettings(
					{ ...parsed.data, actorUserId: session.user.id },
					{ database: dbService.db, clock: systemClock },
				),
			);
		}),
	);
}

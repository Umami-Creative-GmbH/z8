"use server";

import { Effect } from "effect";
import { z } from "zod";
import { systemClock } from "@/lib/datetime/temporal-core";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { organizationAction } from "@/lib/organization-action/organization-action";
import {
	SUBMISSION_WEEKDAYS,
	type SubmissionCadence,
} from "@/lib/time-tracking/period-submissions/cadence";
import { savePeriodSubmissionSettings } from "@/lib/time-tracking/period-submissions/settings";
import {
	MAX_SECOND_REMINDER_DELAY_DAYS,
	MIN_SECOND_REMINDER_DELAY_DAYS,
} from "@/lib/time-tracking/period-submissions/settings-policy";

const invalidSettings = "Enter valid period submission settings";

const cadenceSchema = z.discriminatedUnion(
	"kind",
	[
		z.strictObject({ kind: z.literal("off") }),
		z.strictObject({
			kind: z.literal("weekly"),
			weekStartDay: z.enum(SUBMISSION_WEEKDAYS, { error: invalidSettings }),
		}),
		z.strictObject({ kind: z.literal("monthly") }),
	],
	{ error: invalidSettings },
);
const settingsSchema = z.strictObject(
	{
		cadence: cadenceSchema,
		secondReminderDelayDays: z
			.number({ error: invalidSettings })
			.int({ error: invalidSettings })
			.min(MIN_SECOND_REMINDER_DELAY_DAYS, { error: invalidSettings })
			.max(MAX_SECOND_REMINDER_DELAY_DAYS, { error: invalidSettings }),
	},
	{ error: invalidSettings },
);

export interface UpdatePeriodSubmissionSettingsInput {
	cadence: SubmissionCadence;
	secondReminderDelayDays: number;
}

/** Saves the submission cadence and reminder delay. Org admins only. */
export const updatePeriodSubmissionSettings = organizationAction(
	{ name: "periodSubmissions.saveSettings", requires: "orgAdmin", schema: settingsSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query("periodSubmissions.saveSettings", () =>
				savePeriodSubmissionSettings(
					{ ...input, organizationId, actorUserId: actor.userId },
					{ database: dbService.db, clock: systemClock },
				),
			);
		}),
);

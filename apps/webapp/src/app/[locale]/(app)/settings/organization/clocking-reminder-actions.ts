"use server";

import { Effect } from "effect";
import { z } from "zod";
import { systemClock } from "@/lib/datetime/temporal-core";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { organizationAction } from "@/lib/organization-action/organization-action";
import { saveClockingReminderSettings } from "@/lib/time-tracking/clocking-reminders/settings";
import {
	CLOCKING_REMINDER_ROLES,
	type ClockingReminderGrace,
	type ClockingReminderLead,
	type ClockingReminderRole,
	MAX_CLOCKING_REMINDER_MINUTES,
	MIN_BREAK_DUE_LEAD_MINUTES,
} from "@/lib/time-tracking/clocking-reminders/settings-policy";

const invalidSettings = "Enter valid clocking reminder settings";

const grace = z.strictObject({
	enabled: z.boolean({ error: invalidSettings }),
	graceMinutes: z
		.number({ error: invalidSettings })
		.int({ error: invalidSettings })
		.min(0, { error: invalidSettings })
		.max(MAX_CLOCKING_REMINDER_MINUTES, { error: invalidSettings }),
});
const lead = z.strictObject({
	enabled: z.boolean({ error: invalidSettings }),
	leadMinutes: z
		.number({ error: invalidSettings })
		.int({ error: invalidSettings })
		.min(MIN_BREAK_DUE_LEAD_MINUTES, { error: invalidSettings })
		.max(MAX_CLOCKING_REMINDER_MINUTES, { error: invalidSettings }),
});
const settingsSchema = z.strictObject(
	{
		missedClockIn: grace,
		forgottenClockOut: grace,
		breakDue: lead,
		roles: z
			.array(z.enum(CLOCKING_REMINDER_ROLES, { error: invalidSettings }), {
				error: invalidSettings,
			})
			.min(1, { error: invalidSettings })
			.refine((roles) => new Set(roles).size === roles.length, { error: invalidSettings }),
	},
	{ error: invalidSettings },
);

export interface UpdateClockingReminderSettingsInput {
	missedClockIn: ClockingReminderGrace;
	forgottenClockOut: ClockingReminderGrace;
	breakDue: ClockingReminderLead;
	roles: ClockingReminderRole[];
}

/** Saves the organization's clocking reminder settings. Org admins only. */
export const updateClockingReminderSettings = organizationAction(
	{ name: "clockingReminders.saveSettings", requires: "orgAdmin", schema: settingsSchema },
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query("clockingReminders.saveSettings", () =>
				saveClockingReminderSettings(
					{ ...input, organizationId },
					{ database: dbService.db, clock: systemClock },
				),
			);
		}),
);

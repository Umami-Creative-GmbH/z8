"use server";

import { Effect } from "effect";
import { z } from "zod";
import { systemClock } from "@/lib/datetime/temporal-core";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { organizationAction } from "@/lib/organization-action/organization-action";
import { saveAutoClockOutSettings } from "@/lib/time-tracking/automatic-clock-out/settings";

const invalidDuration = "Enter a valid automatic clock-out duration";

const settingsSchema = z.strictObject({
	autoClockOutEnabled: z.boolean({ error: invalidDuration }),
	maxUninterruptedMinutes: z
		.number({ error: invalidDuration })
		.int({ error: invalidDuration })
		.min(1, { error: invalidDuration })
		.max(2_147_483_647, { error: invalidDuration }),
});

/** Saves the organization's automatic clock-out settings. Org admins only. */
export const updateAutoClockOutSettings = organizationAction(
	{ name: "autoClockOut.saveSettings", requires: "orgAdmin", schema: settingsSchema },
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query("autoClockOut.saveSettings", () =>
				saveAutoClockOutSettings(
					{ ...input, organizationId },
					{ database: dbService.db, clock: systemClock },
				),
			);
		}),
);

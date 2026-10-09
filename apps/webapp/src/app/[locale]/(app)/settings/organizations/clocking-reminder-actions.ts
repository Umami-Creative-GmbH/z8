"use server";

import { Effect, Exit } from "effect";
import { z } from "zod";
import { requireActiveOrganizationActionActor } from "@/lib/auth/organization-action-authorization";
import { getRequestSession } from "@/lib/auth/request-session";
import { systemClock } from "@/lib/datetime/temporal-core";
import { typedFailureOfCause } from "@/lib/effect/cause-failure";
import { AuthenticationError, AuthorizationError, ValidationError } from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import { runtime } from "@/lib/effect/runtime";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { saveClockingReminderSettings } from "@/lib/time-tracking/clocking-reminders/settings";
import {
	CLOCKING_REMINDER_ROLES,
	type ClockingReminderRole,
	type ClockingReminderSettings,
	MAX_CLOCKING_REMINDER_MINUTES,
} from "@/lib/time-tracking/clocking-reminders/settings-policy";

const grace = z.object({
	enabled: z.boolean(),
	graceMinutes: z.number().int().min(0).max(MAX_CLOCKING_REMINDER_MINUTES),
});
const settingsSchema = z.object({
	organizationId: z.string().min(1),
	missedClockIn: grace,
	forgottenClockOut: grace,
	roles: z
		.array(z.enum(CLOCKING_REMINDER_ROLES))
		.min(1)
		.refine((roles) => new Set(roles).size === roles.length),
});

export interface UpdateClockingReminderSettingsInput {
	organizationId: string;
	missedClockIn: { enabled: boolean; graceMinutes: number };
	forgottenClockOut: { enabled: boolean; graceMinutes: number };
	roles: ClockingReminderRole[];
}

export async function updateClockingReminderSettings(
	input: UpdateClockingReminderSettingsInput,
): Promise<ServerActionResult<ClockingReminderSettings>> {
	const effect = Effect.gen(function* () {
		const parsed = settingsSchema.safeParse(input);
		if (!parsed.success) {
			return yield* Effect.fail(
				new ValidationError({ message: "Enter valid clocking reminder settings" }),
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
			message: "Only approved organization admins and owners can change clocking reminder settings",
			resource: "organization",
			action: "update",
		});
		const dbService = yield* DatabaseService;
		return yield* dbService.query("clockingReminders.saveSettings", () =>
			saveClockingReminderSettings(parsed.data, {
				database: dbService.db,
				clock: systemClock,
			}),
		);
	});
	const exit = await runtime.runPromiseExit(effect);
	if (Exit.isSuccess(exit)) return { success: true, data: exit.value };
	const failure = typedFailureOfCause(exit.cause);
	return {
		success: false,
		error: failure?.message ?? "Failed to update clocking reminder settings",
		code: failure?._tag,
	};
}

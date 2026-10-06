"use server";

import { Cause, Effect, Exit, Option } from "effect-v3";
import { z } from "zod";
import { db } from "@/db";
import { requireActiveOrganizationActionActor } from "@/lib/auth/organization-action-authorization";
import { getRequestSession } from "@/lib/auth/request-session";
import { systemClock } from "@/lib/datetime/temporal-core";
import {
	AuthenticationError,
	AuthorizationError,
	DatabaseError,
	ValidationError,
} from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import { DatabaseServiceLive } from "@/lib/effect-v3/services/database.service";
import { saveAutoClockOutSettings } from "@/lib/time-tracking/automatic-clock-out/settings";
import type { AutoClockOutSettings } from "@/lib/time-tracking/automatic-clock-out/types";

const settingsSchema = z.object({
	organizationId: z.string().min(1),
	autoClockOutEnabled: z.boolean(),
	maxUninterruptedMinutes: z.number().int().min(1).max(2_147_483_647),
});

export async function updateAutoClockOutSettings(input: {
	organizationId: string;
	autoClockOutEnabled: boolean;
	maxUninterruptedMinutes: number;
}): Promise<ServerActionResult<AutoClockOutSettings>> {
	const effect = Effect.gen(function* () {
		const parsed = settingsSchema.safeParse(input);
		if (!parsed.success) {
			return yield* Effect.fail(
				new ValidationError({
					message: "Enter a valid automatic clock-out duration",
				}),
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
				"Only approved organization admins and owners can change automatic clock-out settings",
			resource: "organization",
			action: "update",
		});
		return yield* Effect.tryPromise({
			try: () =>
				saveAutoClockOutSettings(parsed.data, {
					database: db,
					clock: systemClock,
				}),
			catch: () =>
				new DatabaseError({
					message: "Failed to update automatic clock-out settings",
					operation: "saveAutoClockOutSettings",
				}),
		});
	}).pipe(Effect.provide(DatabaseServiceLive));
	const exit = await Effect.runPromiseExit(effect);
	if (Exit.isSuccess(exit)) return { success: true, data: exit.value };
	const failure = Option.getOrNull(Cause.failureOption(exit.cause));
	return {
		success: false,
		error: failure?.message ?? "Failed to update automatic clock-out settings",
		code: failure?._tag,
	};
}

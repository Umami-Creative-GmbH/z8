"use server";

import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { auth } from "@/lib/auth";
import { ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { passwordChangeSchema, profileUpdateSchema } from "@/lib/validations/profile";

/**
 * Update user profile (name and/or image) using Effect pattern
 */
export async function updateProfile(data: {
	name: string;
	image?: string | null;
}): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const _session = yield* _(authService.getSession());

		// Step 2: Validate input
		const result = profileUpdateSchema.safeParse(data);
		if (!result.success) {
			return yield* _(
				Effect.fail(
					new ValidationError({
						message: result.error.issues[0]?.message || "Invalid input",
						field: "profile",
					}),
				),
			);
		}

		// Step 3: Prepare update data
		const updateData: { name: string; image?: string | null } = { name: data.name };
		// Handle image: if null, explicitly set to null to remove it
		// if empty string, also set to null to remove it
		// if has value, set it
		if (data.image === null || data.image === "") {
			updateData.image = null;
		} else if (data.image) {
			updateData.image = data.image;
		}

		// Step 4: Update user using Better Auth API
		yield* _(
			Effect.tryPromise({
				try: async () => {
					await auth.api.updateUser({
						body: updateData,
						headers: await headers(),
					});
				},
				catch: (error) => {
					return new ValidationError({
						message: error instanceof Error ? error.message : "Failed to update profile",
						field: "profile",
					});
				},
			}),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Change user password using Effect pattern
 */
export async function changePassword(data: {
	currentPassword: string;
	newPassword: string;
	confirmPassword: string;
	revokeOtherSessions?: boolean;
}): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const _session = yield* _(authService.getSession());

		// Step 2: Validate input
		const result = passwordChangeSchema.safeParse(data);
		if (!result.success) {
			return yield* _(
				Effect.fail(
					new ValidationError({
						message: result.error.issues[0]?.message || "Invalid input",
						field: "password",
					}),
				),
			);
		}

		// Step 3: Change password with Better Auth
		yield* _(
			Effect.tryPromise({
				try: async () => {
					await auth.api.changePassword({
						body: {
							currentPassword: data.currentPassword,
							newPassword: data.newPassword,
							revokeOtherSessions: data.revokeOtherSessions ?? false,
						},
						headers: await headers(),
					});
				},
				catch: (error: unknown) => {
					// Better Auth returns specific error messages
					if (error instanceof Error) {
						if (
							error.message?.includes("Invalid password") ||
							error.message?.includes("Incorrect password")
						) {
							return new ValidationError({
								message: "Current password is incorrect",
								field: "currentPassword",
							});
						}

						return new ValidationError({
							message: error.message || "Failed to change password",
							field: "password",
						});
					}

					return new ValidationError({
						message: "Failed to change password",
						field: "password",
					});
				},
			}),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Update user's timezone preference in userSettings
 */
export async function updateTimezone(timezone: string): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		// Validate timezone (basic check)
		if (!timezone || timezone.length === 0) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Timezone is required",
						field: "timezone",
					}),
				),
			);
		}

		// Update timezone in userSettings with upsert
		yield* _(
			dbService.query("updateTimezone", async () => {
				await dbService.db
					.insert(userSettings)
					.values({
						userId: session.user.id,
						timezone,
					})
					.onConflictDoUpdate({
						target: userSettings.userId,
						set: { timezone },
					});
			}),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get current user's timezone
 */
export async function getCurrentTimezone(): Promise<string> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return "UTC";
	}

	const settingsData = await db.query.userSettings.findFirst({
		where: eq(userSettings.userId, session.user.id),
		columns: {
			timezone: true,
		},
	});

	return settingsData?.timezone || "UTC";
}

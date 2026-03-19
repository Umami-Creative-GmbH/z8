"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { db } from "@/db";
import { employee, userSettings } from "@/db/schema";
import { toAuthStructuredName, trimStructuredNamePart } from "@/lib/auth/derived-user-name";
import { auth } from "@/lib/auth";
import { ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	passwordChangeSchema,
	profileDetailsUpdateSchema,
	profileImageUpdateSchema,
} from "@/lib/validations/profile";

type AuthProfileUpdate = {
	firstName: string | undefined;
	lastName: string | undefined;
	name: string;
	image?: string | null;
};

type StructuredProfileDetailsInput = {
	firstName: string;
	lastName: string;
	gender?: "male" | "female" | "other" | null;
	birthday?: Date | null;
	image?: string | null;
};

type LegacyProfileUpdateInput = {
	name: string;
	image?: string | null;
};

function normalizeProfileImage(image: string | null | undefined): string | null | undefined {
	if (image === null || image === "") {
		return null;
	}

	if (image) {
		return image;
	}

	return undefined;
}

async function updateBetterAuthProfile(
	updateData: AuthProfileUpdate,
): Promise<void> {
	await auth.api.updateUser({
		body: updateData,
		headers: await headers(),
	});
}

function buildStructuredAuthProfile(
	data: StructuredProfileDetailsInput,
	fallbackName: string,
): AuthProfileUpdate {
	const updateData: AuthProfileUpdate = {
		...toAuthStructuredName({
			firstName: data.firstName,
			lastName: data.lastName,
			fallbackName,
		}),
	};
	const normalizedImage = normalizeProfileImage(data.image);

	if (normalizedImage !== undefined) {
		updateData.image = normalizedImage;
	}

	return updateData;
}

function buildSessionAuthProfile(session: {
	user: {
		firstName?: string | null;
		lastName?: string | null;
		name: string;
		image?: string | null;
	};
}): AuthProfileUpdate {
	const updateData: AuthProfileUpdate = {
		...toAuthStructuredName({
			firstName: session.user.firstName ?? "",
			lastName: session.user.lastName ?? "",
			fallbackName: session.user.name,
		}),
	};
	const normalizedImage = normalizeProfileImage(session.user.image);

	if (normalizedImage !== undefined) {
		updateData.image = normalizedImage;
	}

	return updateData;
}

function syncActiveEmployeeProfile(
	dbService: InstanceType<typeof DatabaseService>["Type"],
	userId: string,
	activeOrganizationId: string | undefined,
	data: StructuredProfileDetailsInput,
): Effect.Effect<void, unknown, unknown> {
	return Effect.gen(function* (_) {
		if (!activeOrganizationId) {
			return;
		}

		const activeEmployee = (yield* _(
			dbService.query("findActiveProfileEmployee", async () =>
				dbService.db.query.employee.findFirst({
					where: and(
						eq(employee.userId, userId),
						eq(employee.organizationId, activeOrganizationId),
						eq(employee.isActive, true),
					),
					columns: { id: true },
				}),
			),
		)) as { id: string } | null | undefined;

		if (!activeEmployee) {
			return;
		}

		yield* _(
			dbService.query("syncActiveProfileEmployee", async () => {
				await dbService.db
					.update(employee)
					.set({
						firstName: trimStructuredNamePart(data.firstName) ?? null,
						lastName: trimStructuredNamePart(data.lastName) ?? null,
						gender: data.gender ?? null,
						birthday: data.birthday ?? null,
					})
					.where(
						and(eq(employee.id, activeEmployee.id), eq(employee.organizationId, activeOrganizationId)),
					);
			}),
		);
	});
}

/**
 * Update user profile details using structured names.
 */
export async function updateProfileDetails(data: {
	firstName: string;
	lastName: string;
	gender?: "male" | "female" | "other" | null;
	birthday?: Date | null;
	image?: string | null;
}): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		const result = profileDetailsUpdateSchema.safeParse(data);
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

		const updateData = buildStructuredAuthProfile(result.data, session.user.name);
		const rollbackData = buildSessionAuthProfile(session);

		yield* _(
			Effect.tryPromise({
				try: async () => updateBetterAuthProfile(updateData),
				catch: (error) => {
					return new ValidationError({
						message: error instanceof Error ? error.message : "Failed to update profile",
						field: "profile",
					});
				},
			}),
		);

		yield* _(
			syncActiveEmployeeProfile(
				dbService,
				session.user.id,
				session.session.activeOrganizationId ?? undefined,
				result.data,
			).pipe(
				Effect.catchAll(() =>
					Effect.gen(function* (_) {
						yield* _(
							Effect.tryPromise({
								try: async () => updateBetterAuthProfile(rollbackData),
								catch: () =>
									new ValidationError({
										message: "Failed to update profile",
										field: "profile",
									}),
							}),
						);

						return yield* _(
							Effect.fail(
								new ValidationError({
									message: "Failed to update profile",
									field: "profile",
								}),
							),
						);
					}),
				),
			),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function updateProfile(data: StructuredProfileDetailsInput): Promise<ServerActionResult<void>>;
export async function updateProfile(data: LegacyProfileUpdateInput): Promise<ServerActionResult<void>>;
export async function updateProfile(
	data: StructuredProfileDetailsInput | LegacyProfileUpdateInput,
): Promise<ServerActionResult<void>> {
	if ("firstName" in data && "lastName" in data) {
		return updateProfileDetails(data);
	}

	return updateProfileImage({ image: data.image });
}

/**
 * Update user profile image while preserving stored structured names.
 */
export async function updateProfileImage(data: {
	image?: string | null;
}): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const result = profileImageUpdateSchema.safeParse(data);
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

		const updateData = buildSessionAuthProfile({
			user: {
				firstName: session.user.firstName,
				lastName: session.user.lastName,
				name: session.user.name,
				image: result.data.image,
			},
		});

		yield* _(
			Effect.tryPromise({
				try: async () => updateBetterAuthProfile(updateData),
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

"use server";

import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { notificationPreference } from "@/db/schema";
import { ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	NOTIFICATION_CHANNELS,
	NOTIFICATION_TYPES,
	type NotificationChannel,
	type NotificationType,
	type UserPreferencesResponse,
} from "@/lib/notifications/types";

/**
 * Get all notification preferences for the current user
 * Note: Notification preferences are user-level settings, not organization-specific
 */
export async function getNotificationPreferences(): Promise<
	ServerActionResult<UserPreferencesResponse>
> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		// Get all preferences for this user (user-level, not org-specific)
		const preferences = yield* _(
			dbService.query("getNotificationPreferences", async () => {
				return dbService.db
					.select()
					.from(notificationPreference)
					.where(eq(notificationPreference.userId, session.user.id));
			}),
		);

		// Build preference matrix (all types x all channels, defaulting to true)
		const matrix: Record<NotificationType, Record<NotificationChannel, boolean>> = {} as Record<
			NotificationType,
			Record<NotificationChannel, boolean>
		>;

		// Initialize all to true (default enabled)
		for (const type of NOTIFICATION_TYPES) {
			matrix[type] = {} as Record<NotificationChannel, boolean>;
			for (const channel of NOTIFICATION_CHANNELS) {
				matrix[type][channel] = true;
			}
		}

		// Override with actual preferences
		for (const pref of preferences) {
			if (matrix[pref.notificationType]) {
				matrix[pref.notificationType][pref.channel] = pref.enabled;
			}
		}

		return {
			preferences,
			matrix,
		} satisfies UserPreferencesResponse;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Update a single notification preference
 * Note: Notification preferences are user-level settings, not organization-specific
 */
export async function updateNotificationPreference(data: {
	notificationType: NotificationType;
	channel: NotificationChannel;
	enabled: boolean;
}): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		// Validate notification type
		if (!NOTIFICATION_TYPES.includes(data.notificationType)) {
			return yield* _(
				Effect.fail(
					new ValidationError({
						message: "Invalid notification type",
						field: "notificationType",
					}),
				),
			);
		}

		// Validate channel
		if (!NOTIFICATION_CHANNELS.includes(data.channel)) {
			return yield* _(
				Effect.fail(
					new ValidationError({
						message: "Invalid channel",
						field: "channel",
					}),
				),
			);
		}

		// Upsert the preference (user-level, not org-specific)
		yield* _(
			dbService.query("updateNotificationPreference", async () => {
				const existing = await dbService.db.query.notificationPreference.findFirst({
					where: (pref, { and, eq }) =>
						and(
							eq(pref.userId, session.user.id),
							eq(pref.notificationType, data.notificationType),
							eq(pref.channel, data.channel),
						),
				});

				if (existing) {
					await dbService.db
						.update(notificationPreference)
						.set({ enabled: data.enabled })
						.where(eq(notificationPreference.id, existing.id));
				} else {
					await dbService.db.insert(notificationPreference).values({
						userId: session.user.id,
						notificationType: data.notificationType,
						channel: data.channel,
						enabled: data.enabled,
					});
				}
			}),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Bulk update notification preferences
 * Note: Notification preferences are user-level settings, not organization-specific
 */
export async function bulkUpdateNotificationPreferences(
	preferences: Array<{
		notificationType: NotificationType;
		channel: NotificationChannel;
		enabled: boolean;
	}>,
): Promise<ServerActionResult<{ updated: number }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		// Validate all preferences first
		for (const pref of preferences) {
			if (!NOTIFICATION_TYPES.includes(pref.notificationType)) {
				return yield* _(
					Effect.fail(
						new ValidationError({
							message: `Invalid notification type: ${pref.notificationType}`,
							field: "notificationType",
						}),
					),
				);
			}
			if (!NOTIFICATION_CHANNELS.includes(pref.channel)) {
				return yield* _(
					Effect.fail(
						new ValidationError({
							message: `Invalid channel: ${pref.channel}`,
							field: "channel",
						}),
					),
				);
			}
		}

		// Process each update (user-level, not org-specific)
		yield* _(
			dbService.query("bulkUpdateNotificationPreferences", async () => {
				for (const update of preferences) {
					const existing = await dbService.db.query.notificationPreference.findFirst({
						where: (pref, { and, eq }) =>
							and(
								eq(pref.userId, session.user.id),
								eq(pref.notificationType, update.notificationType),
								eq(pref.channel, update.channel),
							),
					});

					if (existing) {
						await dbService.db
							.update(notificationPreference)
							.set({ enabled: update.enabled })
							.where(eq(notificationPreference.id, existing.id));
					} else {
						await dbService.db.insert(notificationPreference).values({
							userId: session.user.id,
							notificationType: update.notificationType,
							channel: update.channel,
							enabled: update.enabled,
						});
					}
				}
			}),
		);

		return { updated: preferences.length };
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

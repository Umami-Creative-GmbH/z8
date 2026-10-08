"use server";

import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { notificationPreference } from "@/db/schema";
import { isDiscordEnabledForOrganization } from "@/lib/discord";
import { ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	isChannelEnabledByDefault,
	NOTIFICATION_CHANNELS,
	NOTIFICATION_TYPES,
	type NotificationChannel,
	type NotificationType,
	type UserPreferencesResponse,
} from "@/lib/notifications/types";
import { isSlackEnabledForOrganization } from "@/lib/slack";
import { isTeamsEnabledForOrganization } from "@/lib/teams";
import { isTelegramEnabledForOrganization } from "@/lib/telegram";

/**
 * Get all notification preferences for the current user
 * Note: Notification preferences are user-level settings, not organization-specific
 */
export async function getNotificationPreferences(): Promise<
	ServerActionResult<UserPreferencesResponse>
> {
	const effect = Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const dbService = yield* DatabaseService;
		const organizationId = session.session.activeOrganizationId;

		// Preferences are user-level; channel availability remains org-scoped below.
		const preferences = yield* dbService.query("getNotificationPreferences", async () => {
			return dbService.db
				.select()
				.from(notificationPreference)
				.where(eq(notificationPreference.userId, session.user.id));
		});

		const [isTeamsAvailable, isTelegramAvailable, isDiscordAvailable, isSlackAvailable] =
			organizationId
				? yield* dbService.query("getNotificationPreferencesChannelAvailability", async () => {
						return Promise.all([
							isTeamsEnabledForOrganization(organizationId),
							isTelegramEnabledForOrganization(organizationId),
							isDiscordEnabledForOrganization(organizationId),
							isSlackEnabledForOrganization(organizationId),
						]);
					})
				: [false, false, false, false];

		const availableChannels: Record<NotificationChannel, boolean> = {
			in_app: true,
			push: true,
			email: true,
			teams: isTeamsAvailable,
			telegram: isTelegramAvailable,
			discord: isDiscordAvailable,
			slack: isSlackAvailable,
		};

		// Build preference matrix (all types x all channels, at each type's defaults)
		const matrix: Record<NotificationType, Record<NotificationChannel, boolean>> = {} as Record<
			NotificationType,
			Record<NotificationChannel, boolean>
		>;

		for (const type of NOTIFICATION_TYPES) {
			matrix[type] = {} as Record<NotificationChannel, boolean>;
			for (const channel of NOTIFICATION_CHANNELS) {
				matrix[type][channel] = isChannelEnabledByDefault(type, channel);
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
			availableChannels,
		} satisfies UserPreferencesResponse;
	});

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
	const effect = Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const dbService = yield* DatabaseService;

		// Validate notification type
		if (!NOTIFICATION_TYPES.includes(data.notificationType)) {
			return yield* Effect.fail(
				new ValidationError({
					message: "Invalid notification type",
					field: "notificationType",
				}),
			);
		}

		// Validate channel
		if (!NOTIFICATION_CHANNELS.includes(data.channel)) {
			return yield* Effect.fail(
				new ValidationError({
					message: "Invalid channel",
					field: "channel",
				}),
			);
		}
		if (typeof data.enabled !== "boolean") {
			return yield* Effect.fail(
				new ValidationError({
					message: "Invalid enabled value",
					field: "enabled",
				}),
			);
		}

		// Upsert the preference (user-level, not org-specific)
		yield* dbService.query("updateNotificationPreference", async () => {
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
		});
	});

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
	const effect = Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const dbService = yield* DatabaseService;

		// Validate all preferences first
		for (const pref of preferences) {
			if (!NOTIFICATION_TYPES.includes(pref.notificationType)) {
				return yield* Effect.fail(
					new ValidationError({
						message: `Invalid notification type: ${pref.notificationType}`,
						field: "notificationType",
					}),
				);
			}
			if (!NOTIFICATION_CHANNELS.includes(pref.channel)) {
				return yield* Effect.fail(
					new ValidationError({
						message: `Invalid channel: ${pref.channel}`,
						field: "channel",
					}),
				);
			}
			if (typeof pref.enabled !== "boolean") {
				return yield* Effect.fail(
					new ValidationError({
						message: "Invalid enabled value",
						field: "enabled",
					}),
				);
			}
		}

		// Process each update (user-level, not org-specific)
		yield* dbService.query("bulkUpdateNotificationPreferences", async () => {
			await Promise.all(
				preferences.map(async (update) => {
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
			}),
			);
		});

		return { updated: preferences.length };
	});

	return runServerActionSafe(effect);
}

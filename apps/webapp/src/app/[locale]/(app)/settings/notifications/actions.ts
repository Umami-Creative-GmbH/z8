"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { notificationPreference } from "@/db/schema";
import { isDiscordEnabledForOrganization } from "@/lib/discord";
import { type DatabaseClient, DatabaseService } from "@/lib/effect/services/database.service";
import {
	isChannelEnabledByDefault,
	NOTIFICATION_CHANNELS,
	NOTIFICATION_TYPES,
	type NotificationChannel,
	type NotificationType,
	type UserPreferencesResponse,
} from "@/lib/notifications/types";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { isSlackEnabledForOrganization } from "@/lib/slack";
import { isTeamsEnabledForOrganization } from "@/lib/teams";
import { isTelegramEnabledForOrganization } from "@/lib/telegram";

const preferenceSchema = z.strictObject({
	notificationType: z.enum(NOTIFICATION_TYPES, { message: "Invalid notification type" }),
	channel: z.enum(NOTIFICATION_CHANNELS, { message: "Invalid channel" }),
	enabled: z.boolean({ message: "Invalid enabled value" }),
});

type PreferenceUpdate = z.output<typeof preferenceSchema>;

/** Upserts one of the user's preferences; they are user-level, not organization-specific. */
async function upsertPreference(
	db: DatabaseClient,
	userId: string,
	update: PreferenceUpdate,
): Promise<void> {
	const existing = await db.query.notificationPreference.findFirst({
		where: and(
			eq(notificationPreference.userId, userId),
			eq(notificationPreference.notificationType, update.notificationType),
			eq(notificationPreference.channel, update.channel),
		),
	});

	if (existing) {
		await db
			.update(notificationPreference)
			.set({ enabled: update.enabled })
			.where(eq(notificationPreference.id, existing.id));
	} else {
		await db.insert(notificationPreference).values({ userId, ...update });
	}
}

/**
 * The signed-in user's notification preferences, and which channels the active
 * organization offers. Preferences are user-level; channel availability is the
 * organization's.
 */
export const getNotificationPreferences = organizationAction(
	{ name: "notifications.getPreferences", requires: "member", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;

			const preferences = yield* dbService.query("getNotificationPreferences", () =>
				dbService.db
					.select()
					.from(notificationPreference)
					.where(eq(notificationPreference.userId, actor.userId)),
			);

			const [isTeamsAvailable, isTelegramAvailable, isDiscordAvailable, isSlackAvailable] =
				yield* dbService.query("getNotificationPreferencesChannelAvailability", () =>
					Promise.all([
						isTeamsEnabledForOrganization(organizationId),
						isTelegramEnabledForOrganization(organizationId),
						isDiscordEnabledForOrganization(organizationId),
						isSlackEnabledForOrganization(organizationId),
					]),
				);

			const availableChannels: Record<NotificationChannel, boolean> = {
				in_app: true,
				push: true,
				email: true,
				teams: isTeamsAvailable,
				telegram: isTelegramAvailable,
				discord: isDiscordAvailable,
				slack: isSlackAvailable,
			};

			// Every type x channel at the type's default, overridden by the stored preferences.
			const matrix = {} as Record<NotificationType, Record<NotificationChannel, boolean>>;
			for (const type of NOTIFICATION_TYPES) {
				matrix[type] = {} as Record<NotificationChannel, boolean>;
				for (const channel of NOTIFICATION_CHANNELS) {
					matrix[type][channel] = isChannelEnabledByDefault(type, channel);
				}
			}
			for (const pref of preferences) {
				if (matrix[pref.notificationType]) {
					matrix[pref.notificationType][pref.channel] = pref.enabled;
				}
			}

			return { preferences, matrix, availableChannels } satisfies UserPreferencesResponse;
		}),
);

/** Updates one of the signed-in user's notification preferences. */
export const updateNotificationPreference = organizationAction(
	{ name: "notifications.updatePreference", requires: "member", schema: preferenceSchema },
	({ actor, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			yield* dbService.query("updateNotificationPreference", () =>
				upsertPreference(dbService.db, actor.userId, input),
			);
		}),
);

/** Updates several of the signed-in user's notification preferences; all are checked first. */
export const bulkUpdateNotificationPreferences = organizationAction(
	{
		name: "notifications.bulkUpdatePreferences",
		requires: "member",
		schema: z.array(preferenceSchema),
	},
	({ actor, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			yield* dbService.query("bulkUpdateNotificationPreferences", () =>
				Promise.all(input.map((update) => upsertPreference(dbService.db, actor.userId, update))),
			);
			return { updated: input.length };
		}),
);

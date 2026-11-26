"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { notificationPreference } from "@/db/schema";
import {
	buildAvailableNotificationChannels,
	getOrganizationChatChannelAvailability,
} from "@/lib/chat-installations/member-links";
import { ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AuthService } from "@/lib/effect/services/auth.service";
import { type DatabaseClient, DatabaseService } from "@/lib/effect/services/database.service";
import {
	isChannelEnabledByDefault,
	NOTIFICATION_CHANNELS,
	NOTIFICATION_TYPES,
	type NotificationChannel,
	type NotificationType,
	type UserPreferencesResponse,
} from "@/lib/notifications/types";
import {
	loadSettingsAccessFacts,
	SETTINGS_ACCESS_FACTS_QUERY,
	settingsAccessOf,
} from "@/lib/organization-action/settings-access";

const preferenceSchema = z.strictObject({
	notificationType: z.enum(NOTIFICATION_TYPES, { message: "Invalid notification type" }),
	channel: z.enum(NOTIFICATION_CHANNELS, { message: "Invalid channel" }),
	enabled: z.boolean({ message: "Invalid enabled value" }),
});

const bulkPreferencesSchema = z.array(preferenceSchema);

type PreferenceUpdate = z.output<typeof preferenceSchema>;

function parsePreferenceInput<T>(schema: z.ZodType<T>, rawInput: unknown) {
	const parsed = schema.safeParse(rawInput);
	if (parsed.success) {
		return Effect.succeed(parsed.data);
	}
	const issue = parsed.error.issues[0];
	return Effect.fail(
		new ValidationError({
			message: issue?.message ?? "Invalid input",
			field: issue?.path.join(".") || "input",
		}),
	);
}

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
 * Resolves the active organization ID only when the signed-in user has active
 * organization access in it; otherwise returns null so account-wide preferences
 * remain accessible while org-scoped chat channels stay unavailable (ADR 0002).
 */
function loadEligibleActiveOrganizationId(
	userId: string,
	activeOrganizationId: string | null | undefined,
) {
	return Effect.gen(function* () {
		if (!activeOrganizationId) {
			return null;
		}
		const authService = yield* AuthService;
		const orgSession = yield* authService
			.getSession(activeOrganizationId)
			.pipe(Effect.catch(() => Effect.succeed(null)));
		if (!orgSession) {
			return null;
		}

		const dbService = yield* DatabaseService;
		const facts = yield* dbService.query(SETTINGS_ACCESS_FACTS_QUERY, () =>
			loadSettingsAccessFacts(dbService.db, {
				userId,
				organizationId: activeOrganizationId,
			}),
		);
		return settingsAccessOf(facts) !== null ? activeOrganizationId : null;
	});
}

/**
 * The signed-in user's account-wide notification preferences, plus which channels
 * the active organization offers. Absent organization context preserves access to
 * account preferences while reporting org-scoped chat channels as unavailable (ADR 0002).
 */
export async function getNotificationPreferences(): Promise<
	ServerActionResult<UserPreferencesResponse>
> {
	const effect = Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const dbService = yield* DatabaseService;

		const preferences = yield* dbService.query("getNotificationPreferences", () =>
			dbService.db
				.select()
				.from(notificationPreference)
				.where(eq(notificationPreference.userId, session.user.id)),
		);

		const eligibleOrganizationId = yield* loadEligibleActiveOrganizationId(
			session.user.id,
			session.session.activeOrganizationId,
		);

		const chatAvailability = yield* dbService.query(
			"getNotificationPreferencesChannelAvailability",
			() => getOrganizationChatChannelAvailability(eligibleOrganizationId, { db: dbService.db }),
		);

		const availableChannels = buildAvailableNotificationChannels(chatAvailability);

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
	});

	return runServerActionSafe(effect);
}

/** Updates one of the signed-in user's account-wide notification preferences (ADR 0002). */
export async function updateNotificationPreference(
	rawInput: z.input<typeof preferenceSchema>,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const input = yield* parsePreferenceInput(preferenceSchema, rawInput);
		const dbService = yield* DatabaseService;

		yield* dbService.query("updateNotificationPreference", () =>
			upsertPreference(dbService.db, session.user.id, input),
		);
	});

	return runServerActionSafe(effect);
}

/** Updates several of the signed-in user's account-wide notification preferences (ADR 0002). */
export async function bulkUpdateNotificationPreferences(
	rawInput: z.input<typeof bulkPreferencesSchema>,
): Promise<ServerActionResult<{ updated: number }>> {
	const effect = Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const input = yield* parsePreferenceInput(bulkPreferencesSchema, rawInput);
		const dbService = yield* DatabaseService;

		yield* dbService.query("bulkUpdateNotificationPreferences", () =>
			Promise.all(input.map((update) => upsertPreference(dbService.db, session.user.id, update))),
		);
		return { updated: input.length };
	});

	return runServerActionSafe(effect);
}

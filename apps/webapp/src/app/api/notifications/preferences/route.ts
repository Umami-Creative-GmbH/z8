import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { notificationPreference } from "@/db/schema";
import { auth } from "@/lib/auth";
import {
	NOTIFICATION_CHANNELS,
	NOTIFICATION_TYPES,
	type NotificationChannel,
	type NotificationType,
	type UserPreferencesResponse,
} from "@/lib/notifications/types";

/**
 * GET /api/notifications/preferences
 * Get all notification preferences for the current user
 * Note: Notification preferences are user-level settings, not organization-specific
 */
export async function GET() {
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		// Get all preferences for this user (user-level, not org-specific)
		const preferences = await db
			.select()
			.from(notificationPreference)
			.where(eq(notificationPreference.userId, session.user.id));

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

		const response: UserPreferencesResponse = {
			preferences,
			matrix,
		};

		return NextResponse.json(response);
	} catch (error) {
		console.error("Error fetching notification preferences:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/**
 * PUT /api/notifications/preferences
 * Update a notification preference
 * Note: Notification preferences are user-level settings, not organization-specific
 *
 * Body: {
 *   notificationType: NotificationType,
 *   channel: NotificationChannel,
 *   enabled: boolean
 * }
 */
export async function PUT(request: NextRequest) {
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const body = await request.json();
		const { notificationType, channel, enabled } = body;

		// Validate inputs
		if (!NOTIFICATION_TYPES.includes(notificationType)) {
			return NextResponse.json({ error: "Invalid notification type" }, { status: 400 });
		}
		if (!NOTIFICATION_CHANNELS.includes(channel)) {
			return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
		}
		if (typeof enabled !== "boolean") {
			return NextResponse.json({ error: "Invalid enabled value" }, { status: 400 });
		}

		// Upsert the preference (user-level, not org-specific)
		const existing = await db.query.notificationPreference.findFirst({
			where: and(
				eq(notificationPreference.userId, session.user.id),
				eq(notificationPreference.notificationType, notificationType),
				eq(notificationPreference.channel, channel),
			),
		});

		if (existing) {
			// Update existing
			await db
				.update(notificationPreference)
				.set({ enabled })
				.where(eq(notificationPreference.id, existing.id));
		} else {
			// Create new
			await db.insert(notificationPreference).values({
				userId: session.user.id,
				notificationType,
				channel,
				enabled,
			});
		}

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error("Error updating notification preference:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/**
 * POST /api/notifications/preferences
 * Bulk update notification preferences
 * Note: Notification preferences are user-level settings, not organization-specific
 *
 * Body: {
 *   preferences: Array<{
 *     notificationType: NotificationType,
 *     channel: NotificationChannel,
 *     enabled: boolean
 *   }>
 * }
 */
export async function POST(request: NextRequest) {
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const body = await request.json();
		const { preferences: updates } = body;

		if (!Array.isArray(updates)) {
			return NextResponse.json({ error: "Invalid preferences array" }, { status: 400 });
		}

		// Validate all updates first
		for (const update of updates) {
			if (!NOTIFICATION_TYPES.includes(update.notificationType)) {
				return NextResponse.json(
					{ error: `Invalid notification type: ${update.notificationType}` },
					{ status: 400 },
				);
			}
			if (!NOTIFICATION_CHANNELS.includes(update.channel)) {
				return NextResponse.json({ error: `Invalid channel: ${update.channel}` }, { status: 400 });
			}
		}

		// Process each update (user-level, not org-specific)
		for (const update of updates) {
			const existing = await db.query.notificationPreference.findFirst({
				where: and(
					eq(notificationPreference.userId, session.user.id),
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
				await db.insert(notificationPreference).values({
					userId: session.user.id,
					notificationType: update.notificationType,
					channel: update.channel,
					enabled: update.enabled,
				});
			}
		}

		return NextResponse.json({ success: true, updated: updates.length });
	} catch (error) {
		console.error("Error bulk updating notification preferences:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

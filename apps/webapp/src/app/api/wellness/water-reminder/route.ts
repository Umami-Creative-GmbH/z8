import { headers } from "next/headers";
import { connection, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { recipientNotificationTranslator } from "@/lib/notifications/outbound-localization";
import { sendPushToUser } from "@/lib/notifications/push-service";

/**
 * POST /api/wellness/water-reminder
 * Trigger a water reminder push notification for the current user
 *
 * This is called by the client when the reminder interval elapses
 * while the user is clocked in.
 */
export async function POST() {
	await connection();
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		// A direct push, not a stored notification: its text is translated here, in the
		// user's notification language (#812).
		const t = await recipientNotificationTranslator({
			userId: session.user.id,
			organizationId: session.session.activeOrganizationId,
		});

		// Send push notification with water reminder actions
		const result = await sendPushToUser(session.user.id, {
			title: t("common:notifications.content.waterReminder.title", "Time to hydrate!"),
			body: t(
				"common:notifications.content.waterReminder.message",
				"Stay healthy - drink some water",
			),
			icon: "/android-chrome-192x192.png",
			badge: "/favicon-32x32.png",
			tag: "water-reminder",
			data: {
				type: "water_reminder" as const,
				actionUrl: "/",
				actions: [
					{
						action: "log_water",
						title: t("common:notifications.content.waterReminder.done", "Done it!"),
					},
					{
						action: "snooze_water",
						title: t("common:notifications.content.waterReminder.snooze", "Snooze today"),
					},
				],
				requireInteraction: true,
				silent: true, // Visual only, no sound
			},
		});

		return NextResponse.json({
			success: true,
			sent: result.sent,
			failed: result.failed,
		});
	} catch (error) {
		console.error("Error sending water reminder push:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

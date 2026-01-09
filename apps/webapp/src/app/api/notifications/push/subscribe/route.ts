import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isPushAvailable, savePushSubscription } from "@/lib/notifications/push-service";

/**
 * POST /api/notifications/push/subscribe
 * Subscribe to push notifications
 *
 * Body: {
 *   subscription: {
 *     endpoint: string,
 *     keys: {
 *       p256dh: string,
 *       auth: string
 *     }
 *   },
 *   deviceName?: string
 * }
 */
export async function POST(request: NextRequest) {
	try {
		if (!isPushAvailable()) {
			return NextResponse.json({ error: "Push notifications not configured" }, { status: 503 });
		}

		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const body = await request.json();
		const { subscription, deviceName } = body;

		// Validate subscription object
		if (
			!subscription ||
			!subscription.endpoint ||
			!subscription.keys?.p256dh ||
			!subscription.keys?.auth
		) {
			return NextResponse.json({ error: "Invalid subscription object" }, { status: 400 });
		}

		// Get user agent from request headers
		const headersList = await headers();
		const userAgent = headersList.get("user-agent") || undefined;

		const result = await savePushSubscription(session.user.id, subscription, {
			userAgent,
			deviceName,
		});

		if (!result.success) {
			return NextResponse.json(
				{ error: result.error || "Failed to save subscription" },
				{ status: 500 },
			);
		}

		return NextResponse.json({
			success: true,
			subscriptionId: result.id,
		});
	} catch (error) {
		console.error("Error subscribing to push notifications:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

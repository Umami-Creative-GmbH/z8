import { headers } from "next/headers";
import { type NextRequest, NextResponse, connection } from "next/server";
import { auth } from "@/lib/auth";
import { removePushSubscription } from "@/lib/notifications/push-service";

/**
 * POST /api/notifications/push/unsubscribe
 * Unsubscribe from push notifications
 *
 * Body: {
 *   endpoint: string
 * }
 */
export async function POST(request: NextRequest) {
	await connection();
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const body = await request.json();
		const { endpoint } = body;

		if (!endpoint) {
			return NextResponse.json({ error: "Endpoint is required" }, { status: 400 });
		}

		const result = await removePushSubscription(session.user.id, endpoint);

		if (!result.success) {
			return NextResponse.json({ error: "Failed to remove subscription" }, { status: 500 });
		}

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error("Error unsubscribing from push notifications:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

import { headers } from "next/headers";
import { type NextRequest, NextResponse, connection } from "next/server";
import { auth } from "@/lib/auth";
import {
	deactivatePushSubscription,
	getUserPushSubscriptions,
} from "@/lib/notifications/push-service";

/**
 * GET /api/notifications/push/subscriptions
 * Get all push subscriptions for the current user
 */
export async function GET() {
	await connection();
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const subscriptions = await getUserPushSubscriptions(session.user.id);

		return NextResponse.json({ subscriptions });
	} catch (error) {
		console.error("Error fetching push subscriptions:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/**
 * DELETE /api/notifications/push/subscriptions
 * Deactivate a push subscription
 *
 * Body: {
 *   subscriptionId: string
 * }
 */
export async function DELETE(request: NextRequest) {
	await connection();
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const body = await request.json();
		const { subscriptionId } = body;

		if (!subscriptionId) {
			return NextResponse.json({ error: "Subscription ID is required" }, { status: 400 });
		}

		const result = await deactivatePushSubscription(session.user.id, subscriptionId);

		if (!result.success) {
			return NextResponse.json({ error: "Failed to deactivate subscription" }, { status: 500 });
		}

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error("Error deactivating push subscription:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

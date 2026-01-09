import { NextResponse } from "next/server";
import { getVapidPublicKey, isPushAvailable } from "@/lib/notifications/push-service";

/**
 * GET /api/notifications/push/vapid-key
 * Get the VAPID public key for push notification subscription
 */
export async function GET() {
	if (!isPushAvailable()) {
		return NextResponse.json({ error: "Push notifications not configured" }, { status: 503 });
	}

	const publicKey = getVapidPublicKey();

	if (!publicKey) {
		return NextResponse.json({ error: "VAPID public key not available" }, { status: 503 });
	}

	return NextResponse.json({ publicKey });
}

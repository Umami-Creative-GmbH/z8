import { headers } from "next/headers";
import { connection, type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PUSH_DEVICE_PLATFORMS } from "@/db/schema";
import { auth } from "@/lib/auth";
import { createLogger } from "@/lib/logger";
import {
	isNativePushAvailable,
	registerNativePushToken,
	removeNativePushToken,
} from "@/lib/notifications/native-push-service";

const logger = createLogger("NativePushTokenRoute");

const tokenSchema = z.string().min(1).max(4096);
const registerSchema = z.object({ token: tokenSchema, platform: z.enum(PUSH_DEVICE_PLATFORMS) });
const removeSchema = z.object({ token: tokenSchema });

async function readJson(request: NextRequest): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		return null;
	}
}

/**
 * GET /api/notifications/push/native-token
 * Whether the store app may register for native push (FCM configured).
 */
export async function GET() {
	return NextResponse.json({ available: isNativePushAvailable() });
}

/**
 * POST /api/notifications/push/native-token
 * Save this device's FCM token for the signed-in user. Body: { token, platform }.
 */
export async function POST(request: NextRequest) {
	await connection();
	try {
		if (!isNativePushAvailable()) {
			return NextResponse.json({ error: "Native push not configured" }, { status: 503 });
		}
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}
		const body = registerSchema.safeParse(await readJson(request));
		if (!body.success) {
			return NextResponse.json({ error: "Invalid device token" }, { status: 400 });
		}
		await registerNativePushToken(session.user.id, body.data);
		return NextResponse.json({ success: true });
	} catch (error) {
		logger.error({ err: error }, "Failed to save native push token");
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

/**
 * DELETE /api/notifications/push/native-token
 * Remove this device's FCM token, on sign-out or when push is turned off.
 * Works without FCM credentials so a token never outlives its sign-out.
 * Body: { token }.
 */
export async function DELETE(request: NextRequest) {
	await connection();
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}
		const body = removeSchema.safeParse(await readJson(request));
		if (!body.success) {
			return NextResponse.json({ error: "Invalid device token" }, { status: 400 });
		}
		await removeNativePushToken(session.user.id, body.data.token);
		return NextResponse.json({ success: true });
	} catch (error) {
		logger.error({ err: error }, "Failed to remove native push token");
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

import { db } from "@/db";
import { normalizePairingCode } from "@/lib/kiosk/credentials";
import { pairKiosk, readKioskDeviceInfo } from "@/lib/kiosk/store";
import { checkRateLimit, createRateLimitResponse, getClientIp } from "@/lib/rate-limit";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Exchanges a kiosk pairing code for a device token (#859). Public: the device
 * has no user session. Attempts are rate-limited per client IP, and expired,
 * used and wrong codes are all refused the same way.
 */
export async function POST(request: Request) {
	const clientIp = getClientIp(request);
	const rateLimit = await checkRateLimit(clientIp, "kioskPairing");
	if (!rateLimit.allowed) {
		return createRateLimitResponse(rateLimit, request);
	}

	const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
	const code = normalizePairingCode(body?.code);
	if (!code) {
		return Response.json(
			{ error: "Enter the pairing code shown in settings", code: "malformed_code" },
			{ status: 400, headers: NO_STORE },
		);
	}

	const outcome = await db.transaction((tx) =>
		pairKiosk(tx, {
			code,
			ipAddress: clientIp === "unknown" ? null : clientIp,
			userAgent: request.headers.get("user-agent"),
		}),
	);
	if (outcome.status !== "paired") {
		return Response.json(
			{ error: "Invalid or expired pairing code", code: "invalid_code" },
			{ status: 401, headers: NO_STORE },
		);
	}

	return Response.json(
		{ token: outcome.token, kiosk: await readKioskDeviceInfo(db, outcome.kiosk) },
		{ headers: NO_STORE },
	);
}

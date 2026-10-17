import { db } from "@/db";
import {
	kioskRefusalResponse,
	resolveKioskFromRequest,
} from "@/lib/time-tracking/kiosk/authenticate";
import { readKioskSession } from "@/lib/time-tracking/kiosk/kiosk-session.server";
import { KIOSK_TOKEN_HEADER } from "@/lib/time-tracking/kiosk/protocol";

/**
 * The kiosk a device is paired as (#859). The kiosk page calls it on start to
 * choose between pairing, the home screen and the revoked screen; like every
 * kiosk request it records that the kiosk was seen. While offline mode is in
 * effect it also answers this contact's signed anchor and the PIN sealing key
 * (#1289, `KioskSessionResponse`).
 */
export async function GET(request: Request) {
	const authentication = await resolveKioskFromRequest(request);
	if (!authentication.ok) {
		return kioskRefusalResponse(authentication.reason);
	}
	return Response.json(
		await readKioskSession(db, authentication.kiosk, request.headers.get(KIOSK_TOKEN_HEADER) ?? ""),
		{ headers: { "Cache-Control": "no-store" } },
	);
}

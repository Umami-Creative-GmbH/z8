import { db } from "@/db";
import {
	kioskRefusalResponse,
	resolveKioskFromRequest,
} from "@/lib/time-tracking/kiosk/authenticate";
import { readKioskEmployeesResponse } from "@/lib/time-tracking/kiosk/home";

/**
 * The kiosk home screen's employee list (#862): the active employees assigned
 * to the kiosk's location, as id and name, and with offline mode in effect
 * their states (#1291). Authenticated by the kiosk's `x-kiosk-token`; there is
 * no user session.
 */
export async function GET(request: Request) {
	const authentication = await resolveKioskFromRequest(request);
	if (!authentication.ok) {
		return kioskRefusalResponse(authentication.reason);
	}
	const body = await readKioskEmployeesResponse(db, authentication.kiosk);
	return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

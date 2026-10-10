import { db } from "@/db";
import {
	kioskRefusalResponse,
	resolveKioskFromRequest,
} from "@/lib/time-tracking/kiosk/authenticate";
import type { KioskBoardResponse } from "@/lib/time-tracking/kiosk/protocol";
import { readKioskBoard } from "@/lib/time-tracking/who-is-in/queries";

/**
 * The who-is-in board of the kiosk's location (#863). Answers
 * `{ enabled: false, entries: [] }` while the kiosk's board is switched off, so
 * the switch is enforced here and not only by the device. Entries carry the
 * first name, the last initial and "in" or "on break", nothing else.
 */
export async function GET(request: Request) {
	const authentication = await resolveKioskFromRequest(request);
	if (!authentication.ok) {
		return kioskRefusalResponse(authentication.reason);
	}
	const { kiosk } = authentication;
	const body: KioskBoardResponse = kiosk.boardEnabled
		? {
				enabled: true,
				entries: await readKioskBoard(db, {
					organizationId: kiosk.organizationId,
					locationId: kiosk.locationId,
				}),
			}
		: { enabled: false, entries: [] };
	return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

import { db } from "@/db";
import { kioskRefusalResponse, resolveKioskFromRequest } from "@/lib/kiosk/authenticate";
import { readKioskEmployees } from "@/lib/kiosk/home";
import type { KioskEmployeesResponse } from "@/lib/kiosk/protocol";

/**
 * The kiosk home screen's employee list (#862): the active employees assigned
 * to the kiosk's location, as id and name. Authenticated by the kiosk's
 * `x-kiosk-token`; there is no user session.
 */
export async function GET(request: Request) {
	const authentication = await resolveKioskFromRequest(request);
	if (!authentication.ok) {
		return kioskRefusalResponse(authentication.reason);
	}
	const body: KioskEmployeesResponse = {
		employees: await readKioskEmployees(db, authentication.kiosk),
	};
	return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

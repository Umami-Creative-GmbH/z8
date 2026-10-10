import { db } from "@/db";
import { kioskRefusalResponse, resolveKioskFromRequest } from "@/lib/kiosk/authenticate";
import { readKioskDeviceInfo } from "@/lib/kiosk/store";

/**
 * The kiosk a device is paired as (#859). The kiosk page calls it on start to
 * choose between pairing, the home screen and the revoked screen; like every
 * kiosk request it records that the kiosk was seen.
 */
export async function GET(request: Request) {
	const authentication = await resolveKioskFromRequest(request);
	if (!authentication.ok) {
		return kioskRefusalResponse(authentication.reason);
	}
	return Response.json(
		{ kiosk: await readKioskDeviceInfo(db, authentication.kiosk) },
		{ headers: { "Cache-Control": "no-store" } },
	);
}

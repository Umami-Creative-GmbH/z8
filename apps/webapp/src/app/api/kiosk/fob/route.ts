import { kioskFobService } from "@/lib/time-tracking/kiosk/kiosk-fob";

/**
 * Whom a kiosk fob read on the kiosk's home screen selects (#1505):
 * `{ serial }` with the kiosk's `x-kiosk-token`. Records nothing. See
 * `KioskFobLookup` in `@/lib/time-tracking/kiosk/protocol`.
 */
export function POST(request: Request) {
	return kioskFobService.lookup(request);
}

import { kioskClockService } from "@/lib/kiosk/kiosk-clock";

/**
 * Kiosk clocking (#860): `{ employeeId, pin, action, operationId?, breakMinutes? }`
 * with the kiosk's `x-kiosk-token`. See `KioskClockResult` and
 * `KioskClockRefusal` in `@/lib/kiosk/protocol` for the answers.
 */
export function POST(request: Request) {
	return kioskClockService.clock(request);
}

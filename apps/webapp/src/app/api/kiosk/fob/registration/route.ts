import { kioskFobService } from "@/lib/time-tracking/kiosk/kiosk-fob";

/**
 * Registers a kiosk fob at the kiosk (#1505): `{ serial, employeeId, pin }`
 * with the kiosk's `x-kiosk-token`. The PIN is checked (and counts toward the
 * lockout) exactly as for clocking. See `KioskFobRegistrationResult` in
 * `@/lib/time-tracking/kiosk/protocol`.
 */
export function POST(request: Request) {
	return kioskFobService.register(request);
}

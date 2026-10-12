import { kioskClockService } from "@/lib/time-tracking/kiosk/kiosk-clock";

/**
 * A kiosk employee's state and today's day total after their PIN (#860):
 * `{ employeeId, pin }` with the kiosk's `x-kiosk-token`. The PIN is checked
 * (and counts toward the lockout) exactly as for clocking. See
 * `KioskEmployeeSnapshot` in `@/lib/time-tracking/kiosk/protocol`.
 */
export function POST(request: Request) {
	return kioskClockService.status(request);
}

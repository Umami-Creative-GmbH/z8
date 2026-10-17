import { kioskClockService } from "@/lib/time-tracking/kiosk/kiosk-clock";

/**
 * What became of a kiosk action whose reply was lost (#1363):
 * `{ operationId, employeeId, action }` with the kiosk's `x-kiosk-token`, no PIN.
 * See `KioskClockAttemptOutcome` in `@/lib/time-tracking/kiosk/protocol`.
 */
export function POST(request: Request) {
	return kioskClockService.outcome(request);
}

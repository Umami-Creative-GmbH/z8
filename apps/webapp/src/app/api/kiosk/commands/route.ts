import { kioskFrozenCommandService } from "@/lib/time-tracking/kiosk/kiosk-frozen-commands";

/**
 * Frozen kiosk clock commands (#1289): `{ command, pin, contact }` with the
 * kiosk's `x-kiosk-token`, queued while the kiosk was offline. See
 * `KioskFrozenCommandReply` in `@/lib/time-tracking/kiosk/frozen-command`.
 */
export function POST(request: Request) {
	return kioskFrozenCommandService.submit(request);
}

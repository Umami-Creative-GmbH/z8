import "server-only";

import { systemClock } from "@/lib/datetime/temporal-core";
import { checkRateLimit } from "@/lib/rate-limit";
import { createKioskFobService } from "./fob-service";

/**
 * The production kiosk fob endpoints (#1505): registrations count against the
 * kiosk's PIN attempt limit (and the employee's lockout, which always holds),
 * lookups against their own per-kiosk limit; both limiters fail open like every
 * limiter here.
 */
export const kioskFobService = createKioskFobService({
	clock: systemClock,
	limitPinAttempts: (kioskId) => checkRateLimit(`kiosk:${kioskId}`, "kioskPinAttempts"),
	limitFobLookups: (kioskId) => checkRateLimit(`kiosk:${kioskId}`, "kioskFobLookups"),
});

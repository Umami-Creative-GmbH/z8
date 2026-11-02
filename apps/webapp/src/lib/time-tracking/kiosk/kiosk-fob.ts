import "server-only";

import { after } from "next/server";
import { systemClock } from "@/lib/datetime/temporal-core";
import { checkRateLimit } from "@/lib/rate-limit";
import { notifyKioskFobRegistered } from "./fob-registration-notification";
import { createKioskFobService } from "./fob-service";

/**
 * The production kiosk fob endpoints (#1505): registrations count against the
 * kiosk's PIN attempt limit (and the employee's lockout, which always holds),
 * lookups against their own per-kiosk limit; both limiters fail open like every
 * limiter here. A committed registration tells the employee, or a kiosk-only
 * employee's managers (#1507), once the kiosk has its answer.
 */
export const kioskFobService = createKioskFobService({
	clock: systemClock,
	limitPinAttempts: (kioskId) => checkRateLimit(`kiosk:${kioskId}`, "kioskPinAttempts"),
	limitFobLookups: (kioskId) => checkRateLimit(`kiosk:${kioskId}`, "kioskFobLookups"),
	onRegistered: (registration) => notifyKioskFobRegistered(registration),
	afterResponse: after,
});

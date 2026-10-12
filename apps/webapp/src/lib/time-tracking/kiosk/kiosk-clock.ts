import "server-only";

import { systemClock } from "@/lib/datetime/temporal-core";
import { checkRateLimit } from "@/lib/rate-limit";
import { clocking } from "@/lib/time-tracking/clocking";
import { createKioskClockService } from "./clock-service";

/**
 * The production kiosk clocking endpoints (#860): the production Clocking
 * instance (coordinated work transactions, follow-ups after commit, as for web
 * clocking) and the per-kiosk PIN attempt limit, which fails open like every
 * limiter here; the per-employee lockout (#857) always holds.
 */
export const kioskClockService = createKioskClockService({
	clocking,
	clock: systemClock,
	limitPinAttempts: (kioskId) => checkRateLimit(`kiosk:${kioskId}`, "kioskPinAttempts"),
});

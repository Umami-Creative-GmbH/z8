import "server-only";

import { systemClock } from "@/lib/datetime/temporal-core";
import { clocking } from "@/lib/time-tracking/clocking";
import { createKioskFrozenCommandService } from "./frozen-command-service";
import { createKioskFrozenRefusalLedger } from "./frozen-refusal-store";
import { kioskOfflineSecret } from "./kiosk-session.server";

/**
 * The production frozen kiosk command endpoints (#1289): the production Clocking
 * instance, as for online kiosk clocking. Refusals are recorded once per kiosk
 * and operation, notified and listed in the kiosk settings (#1290).
 */
export const kioskFrozenCommandService = createKioskFrozenCommandService({
	clocking,
	clock: systemClock,
	secret: kioskOfflineSecret,
	refusals: createKioskFrozenRefusalLedger(),
});

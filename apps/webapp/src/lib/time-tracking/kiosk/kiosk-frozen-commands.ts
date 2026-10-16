import "server-only";

import { systemClock } from "@/lib/datetime/temporal-core";
import { clocking } from "@/lib/time-tracking/clocking";
import { createKioskFrozenCommandService } from "./frozen-command-service";
import { kioskOfflineSecret } from "./offline-contact";

/**
 * The production frozen kiosk command endpoints (#1289): the production Clocking
 * instance, as for online kiosk clocking. Refusals are not recorded yet (#1290
 * passes its ledger here).
 */
export const kioskFrozenCommandService = createKioskFrozenCommandService({
	clocking,
	clock: systemClock,
	secret: kioskOfflineSecret,
});

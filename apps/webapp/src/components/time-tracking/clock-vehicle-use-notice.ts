"use client";

import type { TFnType } from "@tolgee/react";
import { toast } from "sonner";
import { vehicleUseRefusalText } from "./vehicle-use-format";

/**
 * Tells the employee that entered vehicle use could not be sent with the clock
 * event, which went ahead without it: the entry was refused, or the accepted
 * event could not carry it (`outcome.vehicleUseLeftOut`, an offline clock event
 * under a service worker older than #1122).
 */
export function warnVehicleUseLeftOut(
	result: { ok: true } | { ok: false; code: Parameters<typeof vehicleUseRefusalText>[1] },
	t: TFnType,
	outcome?: object,
) {
	if (!result.ok) {
		toast.warning(t("timeTracking.vehicleUse.notRecorded", "Vehicle use was not recorded"), {
			description: vehicleUseRefusalText(t, result.code),
		});
		return;
	}
	if (outcome && "vehicleUseLeftOut" in outcome && outcome.vehicleUseLeftOut === true) {
		toast.warning(t("timeTracking.vehicleUse.notRecorded", "Vehicle use was not recorded"), {
			description: t(
				"timeTracking.vehicleUse.notSentOffline",
				"It could not be saved with this offline clock event. Add it to the work period once you are online.",
			),
		});
	}
}

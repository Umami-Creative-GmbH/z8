"use client";

import type { TFnType } from "@tolgee/react";
import { toast } from "sonner";
import type { BreakVehicleUse } from "@/lib/time-tracking/vehicle-use/clock-vehicle-use";
import { toastClockCommandError } from "./clock-command-error-toast";
import { type ClockVehicleUseState, warnVehicleUseLeftOut } from "./clock-vehicle-use";

type AddBreakMutation = (params: {
	breakMinutes: number;
	vehicleUse?: BreakVehicleUse;
}) => Promise<{
	success: boolean;
	error?: string;
	code?: string;
}>;

/**
 * The quick break's handler. With the clock's vehicle use (#1122) it sends the
 * break's one odometer reading; a reading that cannot be sent is left out and
 * the break still runs.
 */
export function useQuickBreakHandler(
	addBreak: AddBreakMutation,
	t: TFnType,
	vehicleUse?: ClockVehicleUseState,
) {
	return async (breakMinutes: number) => {
		const reading = vehicleUse?.takenBreak;
		const result = await addBreak({
			breakMinutes,
			...(reading?.ok && reading.vehicleUse ? { vehicleUse: reading.vehicleUse } : {}),
		});

		if (result.success) {
			toast.success(t("timeTracking.quickBreak.success", "Break added"), {
				description: t("timeTracking.quickBreak.successDescription", "You are still clocked in."),
			});
			if (reading) warnVehicleUseLeftOut(reading, t);
			vehicleUse?.reset();
			return { success: true };
		}

		const errorMessage =
			result.error ||
			t("timeTracking.quickBreak.errors.failed", "Failed to add break. Please try again.");

		toastClockCommandError(result, errorMessage);
		return { success: false, error: errorMessage };
	};
}

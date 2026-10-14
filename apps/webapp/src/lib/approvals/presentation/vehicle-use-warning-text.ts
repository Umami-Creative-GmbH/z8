/**
 * Plausibility warnings of vehicle use (#1121, spec #807) as text for reviews
 * and bot messages: the approval inbox and review page (localized text
 * descriptors in the `approvals` namespace) and the bot cards (the approval card
 * and the Teams vehicle use card, `bot` namespace). The web forms use
 * `components/time-tracking/vehicle-use-format.ts`. Pure: no I/O.
 */
import type { BotTranslateFn } from "@/lib/bot-platform/i18n";
import {
	PLAUSIBLE_AVERAGE_SPEED_KMH,
	PLAUSIBLE_DISTANCE_KM,
	type VehicleUseWarning,
} from "@/lib/time-tracking/vehicle-use/plausibility";
import type { ApprovalInboxLocalizedText } from "../inbox/types";

/** A warning as a localized text descriptor of the approvals review. */
export function vehicleUseWarningReviewText(
	warning: VehicleUseWarning,
): ApprovalInboxLocalizedText {
	switch (warning.code) {
		case "start_below_last_end":
			return {
				key: "approvals:approvals.vehicleUseWarning.startBelowLastEnd",
				fallback:
					"The start reading is below this vehicle's last recorded end reading ({lastEndKm} km).",
				params: { lastEndKm: warning.lastRecordedEndKm },
			};
		case "vehicle_on_other_live_work":
			return {
				key: "approvals:approvals.vehicleUseWarning.onOtherLiveWork",
				fallback: "This vehicle is already recorded on another employee's running work.",
			};
		case "speed_above_limit":
			return {
				key: "approvals:approvals.vehicleUseWarning.speedAboveLimit",
				fallback:
					"The driven distance implies an average of {speed} km/h over this work period, more than {limit} km/h.",
				params: { speed: warning.averageKmh, limit: PLAUSIBLE_AVERAGE_SPEED_KMH },
			};
		case "distance_above_limit":
			return {
				key: "approvals:approvals.vehicleUseWarning.distanceAboveLimit",
				fallback: "{distance} km is more than {limit} km in one work period.",
				params: { distance: warning.distanceKm, limit: PLAUSIBLE_DISTANCE_KM },
			};
	}
}

/** A warning as bot text, its numbers in the recipient's locale. */
export function vehicleUseWarningBotText(
	t: BotTranslateFn,
	warning: VehicleUseWarning,
	locale: string,
): string {
	const km = (value: number) => new Intl.NumberFormat(locale).format(value);
	switch (warning.code) {
		case "start_below_last_end":
			return t(
				"bot.vehicleUse.warning.startBelowLastEnd",
				"The start reading is below this vehicle's last recorded end reading ({lastEndKm} km).",
				{ lastEndKm: km(warning.lastRecordedEndKm) },
			);
		case "vehicle_on_other_live_work":
			return t(
				"bot.vehicleUse.warning.onOtherLiveWork",
				"This vehicle is already recorded on another employee's running work.",
			);
		case "speed_above_limit":
			return t(
				"bot.vehicleUse.warning.speedAboveLimit",
				"The driven distance implies an average of {speed} km/h over this work period, more than {limit} km/h.",
				{ speed: km(warning.averageKmh), limit: km(PLAUSIBLE_AVERAGE_SPEED_KMH) },
			);
		case "distance_above_limit":
			return t(
				"bot.vehicleUse.warning.distanceAboveLimit",
				"{distance} km is more than {limit} km in one work period.",
				{ distance: km(warning.distanceKm), limit: km(PLAUSIBLE_DISTANCE_KM) },
			);
	}
}

import type { KioskFrozenRefusalReason } from "./frozen-command";

/**
 * What a refused frozen kiosk command's reason means to the people told about it
 * (#1290): the employee or their managers in the notification, and owners and
 * admins in the kiosk settings. Several reasons read the same to them; the
 * kiosk itself keeps the exact `KioskFrozenRefusalReason`. Client-safe.
 */
export const KIOSK_REFUSAL_EXPLANATIONS = [
	"wrong_pin",
	"pin_locked",
	"pin_unchecked",
	"kiosk_retired",
	"outside_window",
	"clock_untrusted",
	"not_assigned",
	"not_adopted",
	"month_closed",
	"holiday",
	"conflict",
	"other",
] as const;
export type KioskRefusalExplanation = (typeof KIOSK_REFUSAL_EXPLANATIONS)[number];

export function kioskRefusalExplanation(reason: string): KioskRefusalExplanation {
	switch (reason as KioskFrozenRefusalReason) {
		case "wrong_pin":
			return "wrong_pin";
		case "pin_locked":
			return "pin_locked";
		case "no_pin":
		case "pin_unsealable":
			return "pin_unchecked";
		case "kiosk_revoked":
		case "kiosk_rotated":
		case "contact_unverifiable":
			return "kiosk_retired";
		case "admission_window":
			return "outside_window";
		case "clock_out_of_bounds":
			return "clock_untrusted";
		case "employee_not_assigned":
		case "access_denied":
			return "not_assigned";
		case "not_adopted":
			return "not_adopted";
		case "month_closed":
			return "month_closed";
		case "holiday_blocked":
			return "holiday";
		case "already_clocked_in":
		case "occupancy_conflict":
		case "not_clocked_in":
		case "target_unknown":
		case "target_not_active":
		case "already_on_break":
		case "on_break":
		case "no_break_in_progress":
		case "invalid_interval":
		case "under_review":
		case "append_review_required":
		case "collision":
			return "conflict";
		default:
			return "other";
	}
}

import type { KioskBadgeErrorCode } from "@/lib/time-tracking/kiosk/badge-errors";

type Translate = (key: string, defaultValue: string) => string;

/** The translated message for a refused kiosk badge action (#1364). */
export function kioskBadgeErrorMessage(t: Translate, code: KioskBadgeErrorCode): string {
	switch (code) {
		case "sign_in_required":
			return t("settings.kioskBadge.errors.signInRequired", "Sign in to continue.");
		case "not_allowed":
			return t("settings.kioskBadge.errors.notAllowed", "You are not allowed to do this.");
		case "employee_not_found":
			return t("settings.kioskBadge.errors.employeeNotFound", "This employee was not found.");
		case "employee_inactive":
			return t(
				"settings.kioskBadge.errors.employeeInactive",
				"Only active employees can receive a kiosk badge.",
			);
		case "badge_exists":
			return t(
				"settings.kioskBadge.errors.badgeExists",
				"This employee already has a kiosk badge. Replace it instead.",
			);
		case "no_badge":
			return t("settings.kioskBadge.errors.noBadge", "This employee has no kiosk badge.");
		case "badge_changed":
			return t(
				"settings.kioskBadge.errors.badgeChanged",
				"Someone else changed this kiosk badge in the meantime. Check its status and try again.",
			);
		default:
			return t("settings.kioskBadge.errors.failed", "Something went wrong. Please try again.");
	}
}

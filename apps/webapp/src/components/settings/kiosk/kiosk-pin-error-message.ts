import type { KioskPinErrorCode } from "@/lib/time-tracking/kiosk/pin-errors";

type Translate = (key: string, defaultValue: string) => string;

/** The translated message for a refused kiosk PIN or kiosk-only employee action (#857). */
export function kioskPinErrorMessage(t: Translate, code: KioskPinErrorCode): string {
	switch (code) {
		case "sign_in_required":
			return t("settings.kioskPin.errors.signInRequired", "Sign in to continue.");
		case "not_allowed":
			return t("settings.kioskPin.errors.notAllowed", "You are not allowed to do this.");
		case "employee_not_found":
			return t("settings.kioskPin.errors.employeeNotFound", "This employee was not found.");
		case "invalid_pin":
			return t("settings.kioskPin.errors.invalidPin", "A kiosk PIN has 4 to 6 digits.");
		case "pin_exists":
			return t(
				"settings.kioskPin.errors.pinExists",
				"This employee already has a kiosk PIN. Reset it instead.",
			);
		case "no_pin":
			return t("settings.kioskPin.errors.noPin", "This employee has no kiosk PIN yet.");
		case "invalid_name":
			return t(
				"settings.kioskPin.errors.invalidName",
				"Enter a first name of up to 100 characters.",
			);
		case "invalid_email":
			return t("settings.kioskPin.errors.invalidEmail", "Enter a valid email address.");
		case "reserved_email":
			return t("settings.kioskPin.errors.reservedEmail", "This address cannot be used.");
		case "email_in_use":
			return t("settings.kioskPin.errors.emailInUse", "Another account already uses this address.");
		case "email_not_allowed":
			return t(
				"settings.kioskPin.errors.emailNotAllowed",
				"Your organization's sign-in policy does not allow this address.",
			);
		case "team_not_found":
			return t("settings.kioskPin.errors.teamNotFound", "This team was not found.");
		case "not_kiosk_only":
			return t(
				"settings.kioskPin.errors.notKioskOnly",
				"This employee already has an email address.",
			);
		default:
			return t("settings.kioskPin.errors.failed", "Something went wrong. Please try again.");
	}
}

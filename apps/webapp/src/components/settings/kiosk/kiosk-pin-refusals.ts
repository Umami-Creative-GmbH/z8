import type { RefusalMessages } from "@/lib/organization-action/action-error-message";
import type { KioskPinErrorCode } from "@/lib/time-tracking/kiosk/pin-errors";

/** Kiosk PIN and kiosk-only employee texts for `actionErrorMessage` (#857). */
export const KIOSK_PIN_REFUSALS = {
	sign_in_required: ["settings.kioskPin.errors.signInRequired", "Sign in to continue."],
	not_allowed: ["settings.kioskPin.errors.notAllowed", "You are not allowed to do this."],
	employee_not_found: ["settings.kioskPin.errors.employeeNotFound", "This employee was not found."],
	invalid_pin: ["settings.kioskPin.errors.invalidPin", "A kiosk PIN has 4 to 6 digits."],
	pin_exists: [
		"settings.kioskPin.errors.pinExists",
		"This employee already has a kiosk PIN. Reset it instead.",
	],
	no_pin: ["settings.kioskPin.errors.noPin", "This employee has no kiosk PIN yet."],
	invalid_name: [
		"settings.kioskPin.errors.invalidName",
		"Enter a first name of up to 100 characters.",
	],
	invalid_email: ["settings.kioskPin.errors.invalidEmail", "Enter a valid email address."],
	reserved_email: ["settings.kioskPin.errors.reservedEmail", "This address cannot be used."],
	email_in_use: [
		"settings.kioskPin.errors.emailInUse",
		"Another account already uses this address.",
	],
	email_not_allowed: [
		"settings.kioskPin.errors.emailNotAllowed",
		"Your organization's sign-in policy does not allow this address.",
	],
	team_not_found: ["settings.kioskPin.errors.teamNotFound", "This team was not found."],
	location_not_found: ["settings.kioskPin.errors.locationNotFound", "This location was not found."],
	not_kiosk_only: [
		"settings.kioskPin.errors.notKioskOnly",
		"This employee already has an email address.",
	],
	failed: ["settings.kioskPin.errors.failed", "Something went wrong. Please try again."],
} satisfies RefusalMessages<KioskPinErrorCode>;

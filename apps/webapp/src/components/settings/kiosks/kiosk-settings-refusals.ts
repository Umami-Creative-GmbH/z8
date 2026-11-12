import type { RefusalMessages } from "@/lib/organization-action/action-error-message";
import type { KioskSettingsErrorCode } from "@/lib/time-tracking/kiosk/kiosk-settings-errors";

/**
 * Kiosk settings' own texts for `actionErrorMessage`. A `failed` refusal has
 * none: callers pass their own "could not …" fallback.
 */
export const KIOSK_SETTINGS_REFUSALS = {
	admin_only: [
		"settings.kiosks.errors.adminOnly",
		"Only organization owners and admins can manage kiosks.",
	],
	invalid_name: ["settings.kiosks.errors.invalidName", "Enter a name of up to 100 characters."],
	invalid_timezone: ["settings.kiosks.errors.invalidTimezone", "Choose a time zone."],
	location_not_found: [
		"settings.kiosks.errors.locationNotFound",
		"Choose an active location of this organization.",
	],
	kiosk_not_found: ["settings.kiosks.errors.kioskNotFound", "This kiosk was not found."],
	kiosk_revoked: ["settings.kiosks.errors.kioskRevoked", "This kiosk is revoked."],
	offline_needs_adoption: [
		"settings.kiosks.errors.offlineNeedsAdoption",
		"Offline mode needs coordinated clock commands, which this organization does not use yet.",
	],
	invalid_selection: ["settings.kiosks.errors.invalidSelection", "Check your input and try again."],
} satisfies RefusalMessages<Exclude<KioskSettingsErrorCode, "failed">>;

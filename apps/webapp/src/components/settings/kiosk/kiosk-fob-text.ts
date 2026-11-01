import { Temporal } from "temporal-polyfill";
import type { KioskFobManagementErrorCode } from "@/lib/time-tracking/kiosk/fob-errors";
import type { KioskFobViewState } from "@/lib/time-tracking/kiosk/fob-management";

type Translate = (key: string, defaultValue: string, values?: Record<string, string>) => string;

/** An instant's date in the organization's zone, in the UI language. */
export function kioskFobDateLabel(iso: string, zone: string, locale: string): string {
	return Temporal.Instant.from(iso)
		.toZonedDateTimeISO(zone)
		.toPlainDate()
		.toLocaleString(locale, { dateStyle: "medium" });
}

/** An active fob as people see it (#1508): the last 4 hex digits, when and where it was registered. */
export function kioskFobDetails(
	t: Translate,
	fob: KioskFobViewState,
	zone: string,
	locale: string,
): string {
	const values = {
		lastFour: fob.lastFour,
		date: kioskFobDateLabel(fob.registeredAt, zone, locale),
	};
	return fob.kioskName
		? t("settings.kioskFob.details", "Fob ending in {lastFour}, registered on {date} at {kiosk}.", {
				...values,
				kiosk: fob.kioskName,
			})
		: t(
				"settings.kioskFob.detailsKioskGone",
				"Fob ending in {lastFour}, registered on {date} at a kiosk that no longer exists.",
				values,
			);
}

/** The translated message for a refused kiosk fob removal or status read (#1508). */
export function kioskFobErrorMessage(t: Translate, code: KioskFobManagementErrorCode): string {
	switch (code) {
		case "sign_in_required":
			return t("settings.kioskFob.errors.signInRequired", "Sign in to continue.");
		case "not_allowed":
			return t("settings.kioskFob.errors.notAllowed", "You are not allowed to do this.");
		case "employee_not_found":
			return t("settings.kioskFob.errors.employeeNotFound", "This employee was not found.");
		case "no_fob":
			return t("settings.kioskFob.errors.noFob", "There is no kiosk fob to remove.");
		case "fob_changed":
			return t(
				"settings.kioskFob.errors.fobChanged",
				"This kiosk fob changed in the meantime. Check its status and try again.",
			);
		default:
			return t("settings.kioskFob.errors.failed", "Something went wrong. Please try again.");
	}
}

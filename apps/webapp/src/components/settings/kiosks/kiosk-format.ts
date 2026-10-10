import type { useTranslate } from "@tolgee/react";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { KioskErrorCode } from "@/lib/kiosk/errors";

type Translate = ReturnType<typeof useTranslate>["t"];

/**
 * An instant of a kiosk (last seen, code expiry) in the kiosk's own zone,
 * labelled with it: the kiosk's zone is what its clock commands use.
 */
export function formatKioskInstant(locale: string, iso: string, timezone: string): string {
	try {
		const shown = parseInstant(iso)
			.toZonedDateTimeISO(timezone)
			.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
		return `${shown} (${timezone})`;
	} catch {
		return iso;
	}
}

/** The pairing URL the QR code opens on the device: the kiosk page with the code. */
export function kioskPairingUrl(origin: string, locale: string, pairingCode: string): string {
	return `${origin}/${locale}/kiosk?code=${encodeURIComponent(pairingCode)}`;
}

/**
 * The translated reason a kiosk action was refused, or null when the code says
 * nothing the admin can act on (the caller shows its own "could not" message).
 */
export function kioskErrorMessage(t: Translate, code: KioskErrorCode | undefined): string | null {
	switch (code) {
		case "admin_only":
			return t(
				"settings.kiosks.errors.adminOnly",
				"Only organization owners and admins can manage kiosks.",
			);
		case "invalid_name":
			return t("settings.kiosks.errors.invalidName", "Enter a name of up to 100 characters.");
		case "invalid_timezone":
			return t("settings.kiosks.errors.invalidTimezone", "Choose a time zone.");
		case "location_not_found":
			return t(
				"settings.kiosks.errors.locationNotFound",
				"Choose an active location of this organization.",
			);
		case "kiosk_not_found":
			return t("settings.kiosks.errors.kioskNotFound", "This kiosk was not found.");
		case "kiosk_revoked":
			return t("settings.kiosks.errors.kioskRevoked", "This kiosk is revoked.");
		case "invalid_selection":
			return t("settings.kiosks.errors.invalidSelection", "Check your input and try again.");
		default:
			return null;
	}
}

import { parseInstant } from "@/lib/datetime/temporal-core";

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

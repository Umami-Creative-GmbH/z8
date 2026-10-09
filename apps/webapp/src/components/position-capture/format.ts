import { parseInstant } from "@/lib/datetime/temporal-core";

/**
 * A recorded consent or notice instant, shown in UTC with its zone: these are
 * records, never interpreted in the viewer's zone.
 */
export function formatRecordedPositionInstant(locale: string, iso: string): string {
	try {
		return `${parseInstant(iso)
			.toZonedDateTimeISO("UTC")
			.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })} UTC`;
	} catch {
		return iso;
	}
}

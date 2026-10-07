import { type PlainDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";

export function parseDateOnly(value?: string | null): PlainDate | null {
	if (!value) return null;

	try {
		return parsePlainDate(value);
	} catch {
		return null;
	}
}

/** Format a YYYY-MM-DD value for display in the app language, not the browser's. */
export function formatDateOnly(value: string | null | undefined, locale: string) {
	const date = parseDateOnly(value);
	return date ? formatPlainDate(date, locale, "dateMedium") : "";
}

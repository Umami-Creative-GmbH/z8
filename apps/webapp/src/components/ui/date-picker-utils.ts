import { DateTime } from "luxon";

export function parseDateOnly(value?: string | null) {
	if (!value) return null;

	const date = DateTime.fromFormat(value, "yyyy-MM-dd");
	return date.isValid ? date : null;
}

export function formatDateOnly(value?: string | null) {
	const date = parseDateOnly(value);
	return date?.toLocaleString(DateTime.DATE_MED) ?? "";
}

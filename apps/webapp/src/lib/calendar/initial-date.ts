import { parsePlainDate } from "@/lib/datetime/temporal-core";

export function resolveCalendarInitialDate(
	requestedDate: string | undefined,
	fallbackDate: string,
): string {
	if (!requestedDate) {
		return fallbackDate;
	}

	try {
		return parsePlainDate(requestedDate).toString();
	} catch {
		return fallbackDate;
	}
}

import { Temporal } from "temporal-polyfill";
import type { Instant, ZonedDateTime } from "@/lib/datetime/temporal-core";
export function enrollmentNotices(deadline: string, now: Instant) {
	const result: {
		kind: "assigned" | "three-days" | "one-day";
		dueAt: string;
	}[] = [{ kind: "assigned", dueAt: now.toString() }];
	for (const [kind, hours] of [
		["three-days", 72],
		["one-day", 24],
	] as const) {
		const due = Temporal.Instant.from(deadline).subtract({ hours });
		if (Temporal.Instant.compare(due, now) > 0)
			result.push({ kind, dueAt: due.toString() });
	}
	return result;
}
export function formatMfaDeadline(
	deadline: string,
	zone: string | null | undefined,
	locale = "en",
) {
	let value: ZonedDateTime;
	try {
		value = Temporal.Instant.from(deadline).toZonedDateTimeISO(zone || "UTC");
	} catch {
		value = Temporal.Instant.from(deadline).toZonedDateTimeISO("UTC");
	}
	return `${value.toLocaleString(locale, { dateStyle: "long", timeStyle: "long" })} (${value.timeZoneId})`;
}
